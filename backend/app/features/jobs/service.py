"""Job service for managing job configurations and executions."""

from typing import Any, List, Optional
from datetime import datetime, timezone
import math

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc

from .models import JobConfiguration, JobExecution, JobStatus, JobType
from .schemas import (
    JobConfigurationUpdate,
    JobConfigurationResponse,
    JobExecutionResponse,
    JobExecutionListResponse,
)
from .queue_config import (
    normalize_match_fetcher_config,
    has_enabled_match_fetcher_queue,
)
import structlog

logger = structlog.get_logger(__name__)


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

        return response

    # === Job Configuration CRUD ===

    async def get_job_configuration(
        self, job_id: int
    ) -> Optional[JobConfigurationResponse]:
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

    async def list_job_configurations(
        self, active_only: bool = False
    ) -> List[JobConfigurationResponse]:
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
    ) -> Optional[JobConfigurationResponse]:
        """Update a job configuration.

        Args:
            job_id: Job configuration ID.
            job_update: Updated job configuration data.

        Returns:
            Updated job configuration if found, None otherwise.
        """
        query = select(JobConfiguration).where(JobConfiguration.id == job_id)
        result = await self.db.execute(query)
        job = result.scalar_one_or_none()

        if not job:
            return None

        update_dict = job_update.model_dump(exclude_unset=True)
        if not update_dict:
            return self._to_job_response(job)

        # Match Fetcher queue toggles are stored in config_json and drive active state.
        if job.job_type == JobType.MATCH_FETCHER and "config_json" in update_dict:
            incoming_config = update_dict.get("config_json") or {}
            merged_config: dict[str, Any] = {**(job.config_json or {}), **incoming_config}
            normalized_config = normalize_match_fetcher_config(merged_config)
            update_dict["config_json"] = normalized_config
            update_dict["is_active"] = has_enabled_match_fetcher_queue(normalized_config)

        update_dict["updated_at"] = datetime.now(timezone.utc)

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
        self, query, job_config_id: Optional[int], status: Optional[JobStatus]
    ):
        """Apply filters to a job execution query."""
        if job_config_id:
            query = query.where(JobExecution.job_config_id == job_config_id)
        if status:
            query = query.where(JobExecution.status == status)
        return query

    async def list_job_executions(
        self,
        job_config_id: Optional[int] = None,
        status: Optional[JobStatus] = None,
        page: int = 1,
        size: int = 20,
    ) -> JobExecutionListResponse:
        """List job executions with filtering and pagination.

        Args:
            job_config_id: Filter by job configuration ID.
            status: Filter by execution status.
            page: Page number (1-indexed).
            size: Page size.

        Returns:
            Paginated list of job executions.
        """
        # Build base query
        query = select(JobExecution).order_by(desc(JobExecution.started_at))
        query = self._apply_execution_filters(query, job_config_id, status)

        # Get total count
        count_query = select(func.count()).select_from(JobExecution)
        count_query = self._apply_execution_filters(count_query, job_config_id, status)

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
        self, job_config_id: Optional[int] = None
    ) -> Optional[JobExecutionResponse]:
        """Get the most recent job execution.

        Args:
            job_config_id: Optional job configuration ID to filter by.

        Returns:
            Most recent job execution if found, None otherwise.
        """
        query = select(JobExecution).order_by(desc(JobExecution.started_at)).limit(1)

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

    async def get_running_execution_count(self) -> int:
        """Get count of currently running job executions.

        Returns:
            Number of running executions.
        """
        query = (
            select(func.count())
            .select_from(JobExecution)
            .where(JobExecution.status == JobStatus.RUNNING)
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

    async def get_job_config_by_type(
        self, job_type: JobType
    ) -> Optional[JobConfigurationResponse]:
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
