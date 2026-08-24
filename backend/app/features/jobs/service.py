"""Job service for managing job configurations and executions."""

from datetime import UTC, datetime
from typing import Any

import structlog
from sqlalchemy import Select, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .control import (
    get_runtime_control_snapshot,
    is_runtime_job_running,
    request_job_stop,
    runtime_control_key,
    set_runtime_job_paused,
)
from .intervals import resolve_interval_seconds
from .maintenance import (
    lock_riot_writer_tables,
    preserve_riot_writer_maintenance_mode,
)
from .models import ExecutionType, JobConfiguration, JobExecution, JobStatus, JobType
from .schemas import (
    JobConfigurationResponse,
    JobConfigurationUpdate,
    JobControlActionResponse,
    JobExecutionListResponse,
    JobExecutionResponse,
)

logger = structlog.get_logger(__name__)


def _stop_request_message(name: str, *, force: bool, test_run: bool) -> str:
    """The stop confirmation wording; test runs keep their own noun."""
    subject = f"test run of '{name}'" if test_run else f"'{name}'"
    if force:
        return f"Force stop requested for {subject}"
    if test_run:
        return f"Stop requested for {subject}"
    return f"Graceful stop requested for {subject}"


class JobService:
    """Service for handling job configuration and execution operations."""

    def __init__(self, db: AsyncSession):
        """Initialize job service with database session."""
        self.db = db

    @staticmethod
    def _to_job_response(job: JobConfiguration) -> JobConfigurationResponse:
        """Convert ORM model to response with normalized Match Fetcher config."""
        # `interval_seconds` resolves inside the schema's own validator, so
        # every construction site -- not just this one -- carries the number.
        response = JobConfigurationResponse.model_validate(job)

        runtime_state = get_runtime_control_snapshot(job.id)
        response.is_running = runtime_state["is_running"]
        response.is_stopping = runtime_state["stop_requested"]
        response.is_force_stopping = runtime_state["force_stop_requested"]

        # Test runs use negative config ID as runtime key
        test_runtime_state = get_runtime_control_snapshot(
            runtime_control_key(job.id, test_run=True)
        )
        response.is_test_running = test_runtime_state["is_running"]
        response.is_test_stopping = test_runtime_state["stop_requested"]
        response.is_test_force_stopping = test_runtime_state["force_stop_requested"]
        response.is_paused = runtime_state["is_paused"]
        response.is_test_paused = test_runtime_state["is_paused"]

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

        # Merged rather than replaced: an update names the job-specific
        # fields it changes, and the rest of the row's config has to survive it.
        if "config_json" in update_dict:
            update_dict["config_json"] = (
                {**(job.config_json or {}), **incoming_config}
                if job.job_type == JobType.MATCH_FETCHER
                else incoming_config
            )

        update_dict["updated_at"] = datetime.now(UTC)

        for key, value in update_dict.items():
            setattr(job, key, value)

        # After the merge and before the commit: config_json is merged rather
        # than replaced, so only the resolved row can be checked. The scheduler
        # used to be the first thing to notice, and it only logged -- leaving
        # the DB and the running scheduler disagreeing behind a 200.
        resolve_interval_seconds(
            name=job.name,
            schedule=job.schedule,
            config_json=job.config_json,
        )

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

    # The execution filters apply to two different selects — the row query
    # (`Select[tuple[JobExecution]]`) and its count query (`Select[tuple[int]]`)
    # — so the helper hands the caller back the same select type it was given.
    def _apply_execution_filters[SelectT: Select[Any]](
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

        return JobExecutionListResponse(
            executions=[JobExecutionResponse.model_validate(e) for e in executions],
            total=total,
            page=page,
            size=size,
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
            runtime_key = runtime_control_key(
                execution.job_config_id,
                test_run=execution.execution_type == ExecutionType.TEST,
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

    @staticmethod
    def _idle_control_response(
        *,
        test_run: bool,
        is_stopping: bool = False,
        is_force_stopping: bool = False,
    ) -> JobControlActionResponse:
        """The control response when no matching run is active."""
        return JobControlActionResponse(
            success=False,
            message=(
                "No test run is active for this job"
                if test_run
                else "Job is not running"
            ),
            is_running=False,
            is_paused=False,
            is_stopping=is_stopping,
            is_force_stopping=is_force_stopping,
        )

    async def set_job_paused(
        self,
        job_id: int,
        paused: bool,
        *,
        test_run: bool = False,
    ) -> JobControlActionResponse | None:
        """Pause or resume a running job execution (or its test run).

        Pause lives on the run's own runtime-control entry (test runs under
        the negated config ID), so a test run's pause and a concurrent
        scheduled run's pause cannot interfere — and the flag dies with the
        run instead of needing a clear-on-stop or a startup reset.
        """
        job = await self.get_job_configuration_model(job_id)
        if not job:
            return None

        runtime_key = runtime_control_key(job.id, test_run=test_run)
        was_applied = set_runtime_job_paused(runtime_key, paused)
        runtime_state = get_runtime_control_snapshot(runtime_key)
        if not was_applied:
            return self._idle_control_response(
                test_run=test_run,
                is_stopping=runtime_state["stop_requested"],
                is_force_stopping=runtime_state["force_stop_requested"],
            )

        action = "paused" if paused else "resumed"
        subject = f"Test run for '{job.name}'" if test_run else f"Job '{job.name}'"
        return JobControlActionResponse(
            success=True,
            message=f"{subject} {action}",
            is_running=True,
            is_paused=paused,
            is_stopping=runtime_state["stop_requested"],
            is_force_stopping=runtime_state["force_stop_requested"],
        )

    async def request_job_stop_action(
        self,
        job_id: int,
        force: bool,
        *,
        test_run: bool = False,
    ) -> JobControlActionResponse | None:
        """Request graceful or forced stop for a running job execution."""
        job = await self.get_job_configuration_model(job_id)
        if not job:
            return None

        runtime_key = runtime_control_key(job.id, test_run=test_run)
        was_applied = request_job_stop(runtime_key, force=force)
        runtime_state = get_runtime_control_snapshot(runtime_key)

        if not was_applied:
            return self._idle_control_response(test_run=test_run)

        return JobControlActionResponse(
            success=True,
            message=_stop_request_message(job.name, force=force, test_run=test_run),
            is_running=runtime_state["is_running"],
            is_paused=runtime_state["is_paused"],
            is_stopping=runtime_state["stop_requested"],
            is_force_stopping=runtime_state["force_stop_requested"],
        )
