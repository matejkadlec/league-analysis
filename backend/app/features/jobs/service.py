"""Job service for managing job configurations and executions."""

import math
from datetime import UTC, datetime
from typing import Any, TypeVar

import structlog
from sqlalchemy import Select, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .control import (
    get_runtime_control_snapshot,
    is_runtime_job_running,
    request_job_stop,
)
from .maintenance import (
    lock_riot_writer_tables,
    preserve_riot_writer_maintenance_mode,
)
from .models import ExecutionType, JobConfiguration, JobExecution, JobStatus, JobType
from .queue_config import normalize_match_fetcher_config
from .schemas import (
    JobConfigurationResponse,
    JobConfigurationUpdate,
    JobControlActionResponse,
    JobExecutionListResponse,
    JobExecutionResponse,
)

logger = structlog.get_logger(__name__)

# The execution filters apply to two different selects — the row query
# (`Select[tuple[JobExecution]]`) and its count query (`Select[tuple[int]]`) —
# so the helper has to hand the caller back the same select type it was given.
SelectT = TypeVar("SelectT", bound=Select[Any])


class JobService:
    """Service for handling job configuration and execution operations."""

    def __init__(self, db: AsyncSession):
        """Initialize job service with database session."""
        self.db = db

    @staticmethod
    def _to_job_response(job: JobConfiguration) -> JobConfigurationResponse:
        """Convert ORM model to response with normalized Match Fetcher config."""
        response = JobConfigurationResponse.model_validate(job)

        if response.job_type == JobType.MATCH_FETCHER:
            response.config_json = normalize_match_fetcher_config(response.config_json)

        runtime_state = get_runtime_control_snapshot(job.id)
        response.is_running = runtime_state["is_running"]
        response.is_stopping = runtime_state["stop_requested"]
        response.is_force_stopping = runtime_state["force_stop_requested"]

        # Test runs use negative config ID as runtime key
        test_runtime_state = get_runtime_control_snapshot(-job.id)
        response.is_test_running = test_runtime_state["is_running"]
        response.is_test_stopping = test_runtime_state["stop_requested"]
        response.is_test_force_stopping = test_runtime_state["force_stop_requested"]
        # Re-read is_paused from the ORM model to reflect current DB state
        response.is_paused = bool(job.is_paused)

        return response

    # === Job Configuration CRUD ===

    async def get_job_configuration(
        self, job_id: int
    ) -> JobConfigurationResponse | None:
        """Get a job configuration by ID.

        Args:
            job_id: Job configuration ID.

        Returns:
            Job configuration if found, None otherwise.
        """
        query = select(JobConfiguration).where(JobConfiguration.id == job_id)
        result = await self.db.execute(query)
        job = result.scalar_one_or_none()

        if job:
            return self._to_job_response(job)
        return None

    async def get_job_configuration_model(self, job_id: int) -> JobConfiguration | None:
        """Get the ORM model for a job configuration by ID."""
        query = select(JobConfiguration).where(JobConfiguration.id == job_id)
        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def list_job_configurations(
        self, active_only: bool = False
    ) -> list[JobConfigurationResponse]:
        """List all job configurations.

        Args:
            active_only: If True, return only active job configurations.

        Returns:
            List of job configurations.
        """
        query = select(JobConfiguration).order_by(JobConfiguration.name)

        if active_only:
            query = query.where(JobConfiguration.is_active)

        result = await self.db.execute(query)
        jobs = result.scalars().all()

        return [self._to_job_response(job) for job in jobs]

    async def update_job_configuration(
        self, job_id: int, job_update: JobConfigurationUpdate
    ) -> JobConfigurationResponse | None:
        """Update a job configuration.

        Args:
            job_id: Job configuration ID.
            job_update: Updated job configuration data.

        Returns:
            Updated job configuration if found, None otherwise.
        """
        await lock_riot_writer_tables(self.db)
        query = (
            select(JobConfiguration)
            .where(JobConfiguration.id == job_id)
            .with_for_update()
        )
        result = await self.db.execute(query)
        job = result.scalar_one_or_none()

        if not job:
            return None

        update_dict = job_update.model_dump(exclude_unset=True)
        if not update_dict:
            return self._to_job_response(job)

        incoming_config: dict[str, Any] = {}
        if "config_json" in update_dict:
            incoming_config = preserve_riot_writer_maintenance_mode(
                job.job_type,
                job.config_json,
                update_dict.get("config_json"),
            )

        # Per-queue Match Fetcher configuration is obsolete. Merge other
        # job-specific fields, then strip the legacy key so it cannot restrict
        # the canonical supported queue set or leak back through the API.
        if job.job_type == JobType.MATCH_FETCHER and "config_json" in update_dict:
            merged_config: dict[str, Any] = {
                **(job.config_json or {}),
                **incoming_config,
            }
            normalized_config = normalize_match_fetcher_config(merged_config)
            update_dict["config_json"] = normalized_config
        elif "config_json" in update_dict:
            update_dict["config_json"] = incoming_config

        update_dict["updated_at"] = datetime.now(UTC)

        for key, value in update_dict.items():
            setattr(job, key, value)

        await self.db.commit()
        await self.db.refresh(job)

        logger.info(
            "Job configuration updated",
            job_id=job_id,
            job_name=job.name,
            updated_fields=list(update_dict.keys()),
            is_active=job.is_active,
        )
        return self._to_job_response(job)

    # === Job Execution Operations ===

    def _apply_execution_filters(
        self,
        query: SelectT,
        job_config_id: int | None,
        status: JobStatus | None,
        execution_type: ExecutionType | None = None,
    ) -> SelectT:
        """Apply filters to a job execution query."""
        if job_config_id:
            query = query.where(JobExecution.job_config_id == job_config_id)
        if status:
            query = query.where(JobExecution.status == status)
        if execution_type:
            query = query.where(JobExecution.execution_type == execution_type)
        return query

    async def list_job_executions(
        self,
        job_config_id: int | None = None,
        status: JobStatus | None = None,
        execution_type: ExecutionType | None = None,
        page: int = 1,
        size: int = 20,
    ) -> JobExecutionListResponse:
        """List job executions with filtering and pagination.

        Args:
            job_config_id: Filter by job configuration ID.
            status: Filter by execution status.
            execution_type: Filter by execution type (REGULAR or TEST).
            page: Page number (1-indexed).
            size: Page size.

        Returns:
            Paginated list of job executions.
        """
        # Build base query
        query = select(JobExecution).order_by(desc(JobExecution.started_at))
        query = self._apply_execution_filters(
            query, job_config_id, status, execution_type
        )

        # Get total count
        count_query = select(func.count()).select_from(JobExecution)
        count_query = self._apply_execution_filters(
            count_query, job_config_id, status, execution_type
        )

        total_result = await self.db.execute(count_query)
        total = total_result.scalar() or 0

        # Apply pagination
        offset = (page - 1) * size
        query = query.offset(offset).limit(size)

        # Execute query
        result = await self.db.execute(query)
        executions = result.scalars().all()

        # Calculate pages
        pages = math.ceil(total / size) if size > 0 else 0

        return JobExecutionListResponse(
            executions=[JobExecutionResponse.model_validate(e) for e in executions],
            total=total,
            page=page,
            size=size,
            pages=pages,
        )

    async def get_latest_execution(
        self, job_config_id: int | None = None
    ) -> JobExecutionResponse | None:
        """Get the most recent regular job execution.

        Args:
            job_config_id: Optional job configuration ID to filter by.

        Returns:
            Most recent regular job execution if found, None otherwise.
        """
        query = (
            select(JobExecution)
            .where(JobExecution.execution_type == ExecutionType.REGULAR)
            .order_by(desc(JobExecution.started_at))
            .limit(1)
        )

        if job_config_id:
            query = query.where(JobExecution.job_config_id == job_config_id)

        result = await self.db.execute(query)
        execution = result.scalar_one_or_none()

        if execution:
            return JobExecutionResponse.model_validate(execution)
        return None

    # === Job Status and Metrics ===

    async def get_active_job_count(self) -> int:
        """Get count of active job configurations.

        Returns:
            Number of active jobs.
        """
        query = (
            select(func.count())
            .select_from(JobConfiguration)
            .where(JobConfiguration.is_active)
        )

        result = await self.db.execute(query)
        return result.scalar() or 0

    async def _cleanup_orphaned_running_executions(self) -> int:
        """Mark RUNNING/PAUSED executions as FAILED if no in-memory runtime control exists.

        This handles cases where a job execution record is stuck in RUNNING or PAUSED
        state (e.g. due to a race condition during startup or a failed completion update)
        but the job is no longer actually running in memory.

        Returns:
            Number of orphaned executions cleaned up.
        """
        query = select(JobExecution).where(
            JobExecution.status.in_([JobStatus.RUNNING, JobStatus.PAUSED])
        )
        result = await self.db.execute(query)
        running_executions = result.scalars().all()

        cleaned = 0
        for execution in running_executions:
            # Test runs register under negative key; regular under positive
            runtime_key = (
                -execution.job_config_id
                if execution.execution_type == ExecutionType.TEST
                else execution.job_config_id
            )
            if not is_runtime_job_running(runtime_key):
                execution.status = JobStatus.FAILED
                execution.completed_at = datetime.now(UTC)
                execution.error_message = (
                    "Execution orphaned - no active runtime control found"
                )
                cleaned += 1

        if cleaned > 0:
            await self.db.commit()
            logger.warning(
                "Cleaned up orphaned running executions",
                count=cleaned,
            )

        return cleaned

    async def get_running_execution_count(self) -> int:
        """Get count of currently running regular job executions.

        Cross-references DB records with in-memory runtime controls.
        Automatically cleans up orphaned RUNNING records.
        Test runs are excluded from the count.

        Returns:
            Number of truly running regular executions.
        """
        await self._cleanup_orphaned_running_executions()

        query = (
            select(func.count())
            .select_from(JobExecution)
            .where(JobExecution.status.in_([JobStatus.RUNNING, JobStatus.PAUSED]))
            .where(JobExecution.execution_type == ExecutionType.REGULAR)
        )

        result = await self.db.execute(query)
        return result.scalar() or 0

    async def is_job_running(self, job_type: JobType) -> bool:
        """Check if a job of the given type is currently running.

        Args:
            job_type: The type of job to check.

        Returns:
            True if a job of this type is running, False otherwise.
        """
        query = (
            select(func.count())
            .select_from(JobExecution)
            .join(JobConfiguration, JobExecution.job_config_id == JobConfiguration.id)
            .where(JobExecution.status == JobStatus.RUNNING)
            .where(JobConfiguration.job_type == job_type)
        )

        result = await self.db.execute(query)
        count = result.scalar() or 0
        return count > 0

    async def get_job_control_state(
        self, job_id: int
    ) -> JobControlActionResponse | None:
        """Get runtime control state for a specific job configuration."""
        job = await self.get_job_configuration_model(job_id)
        if not job:
            return None

        runtime_state = get_runtime_control_snapshot(job_id)
        return JobControlActionResponse(
            success=True,
            message="Job control state loaded",
            is_running=runtime_state["is_running"],
            is_paused=bool(job.is_paused),
            is_stopping=runtime_state["stop_requested"],
            is_force_stopping=runtime_state["force_stop_requested"],
        )

    async def set_job_paused(
        self,
        job_id: int,
        paused: bool,
    ) -> JobControlActionResponse | None:
        """Pause or resume a running job execution."""
        job = await self.get_job_configuration_model(job_id)
        if not job:
            return None

        runtime_state = get_runtime_control_snapshot(job_id)
        if not runtime_state["is_running"]:
            return JobControlActionResponse(
                success=False,
                message="Job is not running",
                is_running=False,
                is_paused=bool(job.is_paused),
                is_stopping=runtime_state["stop_requested"],
                is_force_stopping=runtime_state["force_stop_requested"],
            )

        job.is_paused = paused
        job.updated_at = datetime.now(UTC)
        await self.db.commit()
        await self.db.refresh(job)

        action = "paused" if paused else "resumed"
        return JobControlActionResponse(
            success=True,
            message=f"Job '{job.name}' {action}",
            is_running=True,
            is_paused=bool(job.is_paused),
            is_stopping=runtime_state["stop_requested"],
            is_force_stopping=runtime_state["force_stop_requested"],
        )

    async def request_job_stop_action(
        self,
        job_id: int,
        force: bool,
    ) -> JobControlActionResponse | None:
        """Request graceful or forced stop for a running job execution."""
        job = await self.get_job_configuration_model(job_id)
        if not job:
            return None

        was_applied = request_job_stop(job_id, force=force)
        runtime_state = get_runtime_control_snapshot(job_id)

        if not was_applied:
            return JobControlActionResponse(
                success=False,
                message="Job is not running",
                is_running=False,
                is_paused=bool(job.is_paused),
                is_stopping=False,
                is_force_stopping=False,
            )

        # Ensure paused flag does not remain stuck when stopping.
        if job.is_paused:
            job.is_paused = False
            job.updated_at = datetime.now(UTC)
            await self.db.commit()
            await self.db.refresh(job)

        return JobControlActionResponse(
            success=True,
            message=(
                f"Force stop requested for '{job.name}'"
                if force
                else f"Graceful stop requested for '{job.name}'"
            ),
            is_running=runtime_state["is_running"],
            is_paused=bool(job.is_paused),
            is_stopping=runtime_state["stop_requested"],
            is_force_stopping=runtime_state["force_stop_requested"],
        )

    async def get_job_config_by_type(
        self, job_type: JobType
    ) -> JobConfigurationResponse | None:
        """Get job configuration by job type.

        Args:
            job_type: The type of job to find.

        Returns:
            Job configuration if found, None otherwise.
        """
        query = (
            select(JobConfiguration)
            .where(JobConfiguration.job_type == job_type)
            .limit(1)
        )
        result = await self.db.execute(query)
        job = result.scalar_one_or_none()

        if job:
            return self._to_job_response(job)
        return None
