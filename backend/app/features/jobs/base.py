"""Base job class for automated background jobs."""

import asyncio
from abc import ABC, abstractmethod
from collections import defaultdict
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional

import structlog
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from structlog import contextvars as structlog_contextvars

from app.core import db_manager

from .control import (
    get_runtime_control_snapshot,
    is_runtime_job_running,
    register_runtime_control,
    unregister_runtime_control,
)
from .error_handling import (
    RateLimitSignal,
    diagnostic_error,
    is_riot_puuid_binding_error,
)
from .log_capture import job_log_capture
from .maintenance import is_riot_writer_maintenance_active
from .models import ExecutionType, JobConfiguration, JobExecution, JobStatus

logger = structlog.get_logger(__name__)


class JobStopSignal(Exception):
    """Signal used for graceful/forced stops before a job writes data."""

    def __init__(self, force: bool = False, reason: str = "user_requested"):
        self.force = force
        self.reason = reason
        super().__init__(f"Job stopped: {reason}")


def _format_api_calls_for_storage(api_calls: List[Any]) -> List[Dict[str, Any]]:
    """Format API call records for JSONB storage, grouping similar calls."""
    from collections import defaultdict

    # Group calls by endpoint
    grouped: Dict[str, Dict[str, Any]] = defaultdict(
        lambda: {
            "count": 0,
            "region": None,
            "params_list": [],
            "first_timestamp": None,
            "last_timestamp": None,
        }
    )

    for call in api_calls:
        endpoint = call.endpoint
        group = grouped[endpoint]
        group["count"] += 1
        group["region"] = call.region
        group["params_list"].append(call.params)

        if group["first_timestamp"] is None:
            group["first_timestamp"] = call.timestamp
        group["last_timestamp"] = call.timestamp

    # Convert to list format for storage
    result = []
    for endpoint, data in grouped.items():
        entry = {
            "endpoint": endpoint,
            "region": data["region"],
            "count": data["count"],
            "first_timestamp": data["first_timestamp"],
            "last_timestamp": data["last_timestamp"],
        }

        # For single calls or calls with different params, include params
        if data["count"] == 1:
            entry["params"] = data["params_list"][0]
        else:
            # For multiple calls, store first and last param values
            # Extract the key param (matchId, puuid, etc.)
            param_key = (
                list(data["params_list"][0].keys())[0]
                if data["params_list"][0]
                else None
            )
            if param_key:
                first_val = data["params_list"][0].get(param_key)
                last_val = data["params_list"][-1].get(param_key)
                entry["param_key"] = param_key
                entry["first_param"] = first_val
                entry["last_param"] = last_val

        result.append(entry)

    return result


class BaseJob(ABC):
    """Abstract base class for all automated jobs.

    Provides common functionality for job execution:
    - Job execution tracking and logging
    - Error handling and metrics collection
    - Database session management
    - Structured logging with correlation IDs

    Subclasses must implement:
    - execute(): The main job logic
    """

    recorded_errors_are_fatal = True

    def __init__(
        self,
        job_config_id: int,
        triggered_by: str = "system",
        execution_type: ExecutionType = ExecutionType.REGULAR,
    ):
        """Initialize the job with its configuration ID.

        Args:
            job_config_id: ID of job configuration from database.
            triggered_by: Who triggered the job: 'system' (scheduler) or 'user' (manual).
            execution_type: Type of execution: REGULAR or TEST.
        """
        self.job_config_id = job_config_id
        self.triggered_by = triggered_by
        self.execution_type = execution_type
        self.job_config: Optional[JobConfiguration] = None
        self.job_execution: Optional[JobExecution] = None
        # Plain copies of the identity and start time. A rollback expires every
        # ORM attribute, and reloading one outside the async greenlet raises
        # MissingGreenlet, so completion paths must never read them off the
        # instance.
        self.job_execution_id: Optional[int] = None
        self.job_execution_started_at: Optional[datetime] = None
        self.metrics = defaultdict(int)
        self.metrics.update(
            {
                "api_requests_made": 0,
                "records_created": 0,
                "records_updated": 0,
            }
        )
        self.execution_log: Dict[str, Any] = {}
        # Track safe, structured diagnostics for errors encountered during execution.
        self._errors_encountered: List[Dict[str, Any]] = []
        self._has_api_key_error: bool = False
        self._has_puuid_binding_error: bool = False
        self._completion_logged: bool = False
        # Track API call records for detailed logging
        self._api_call_records: List[Any] = []

    @property
    def runtime_key(self) -> int:
        """Runtime control key. Negative for TEST runs to avoid conflicts with regular runs."""
        if self.execution_type == ExecutionType.TEST:
            return -self.job_config_id
        return self.job_config_id

    @abstractmethod
    async def execute(self, db: AsyncSession) -> None:
        """Execute the job logic.

        This method must be implemented by subclasses.
        It should contain the main job logic and use self.metrics
        to track execution statistics.

        Args:
            db: Database session for job execution.

        Raises:
            Exception: If job execution fails.
        """
        pass

    async def _refresh_config(self, db: AsyncSession) -> None:
        """Load fresh job configuration from database.

        Expires any cached ORM state first so changes committed by other
        sessions (e.g. the API router setting is_paused) are visible.

        Args:
            db: Database session for querying configuration.

        Raises:
            Exception: If configuration is missing or invalid.
        """
        # Expire cached state so the SELECT actually hits the DB
        if self.job_config is not None:
            db.expire(self.job_config)

        stmt = select(JobConfiguration).where(JobConfiguration.id == self.job_config_id)
        result = await db.execute(stmt)
        job_config = result.scalar_one_or_none()

        if job_config is None:
            raise Exception(
                f"Job configuration {self.job_config_id} not found or deleted"
            )

        self.job_config = job_config
        logger.debug(
            "Job configuration refreshed",
            job_config_id=self.job_config_id,
            job_name=self.job_config.name,
            job_type=self.job_config.job_type.value,
        )

    async def log_start(self, db: AsyncSession) -> None:
        """Log job execution start and create JobExecution record."""
        try:
            self.job_execution = JobExecution(
                job_config_id=self.job_config_id,
                started_at=datetime.now(timezone.utc),
                status=JobStatus.RUNNING,
                api_requests_made=0,
                records_created=0,
                records_updated=0,
                execution_log={},
                detailed_logs=None,  # Will be populated on completion
                triggered_by=self.triggered_by,
                execution_type=self.execution_type,
            )
            db.add(self.job_execution)
            if not await self.safe_commit(db, "job start"):
                raise Exception("Failed to create job execution record")
            await db.refresh(self.job_execution)
            self.job_execution_id = self.job_execution.id
            self.job_execution_started_at = self.job_execution.started_at

            logger.debug(
                "Job execution started",
                job_config_id=self.job_config_id,
                execution_id=self.job_execution_id,
            )

        except Exception as e:
            logger.error(
                "Failed to log job start",
                job_config_id=self.job_config_id,
                error=str(e),
                error_type=type(e).__name__,
            )
            await db.rollback()
            raise

    async def log_completion(
        self,
        db: AsyncSession,
        success: bool = True,
        error_message: Optional[str] = None,
        logs: Optional[List[Dict[str, Any]]] = None,
        status: Optional[JobStatus] = None,
    ) -> None:
        """Log job execution completion and update JobExecution record.

        :param db: Database session
        :param success: Whether the job succeeded
        :param error_message: Optional error message
        :param logs: Optional list of log entries
        :param status: Optional explicit status (overrides success-based status)
        """
        # Exit early if job execution was never started
        if self.job_execution is None:
            logger.warning(
                "Cannot log completion, job execution not started",
                job_config_id=self.job_config_id,
            )
            return

        try:
            completed_at = datetime.now(timezone.utc)
            started_at = self.job_execution_started_at or completed_at
            duration = (completed_at - started_at).total_seconds()

            self._log_completion_details(success, duration)

            # Prepare detailed logs for database storage
            detailed_logs: Dict[str, Any] | None = {}
            if logs:
                detailed_logs["logs"] = self._strip_redundant_fields(logs)

            # Add API call records if available
            if self._api_call_records:
                detailed_logs["api_calls"] = _format_api_calls_for_storage(
                    self._api_call_records
                )

            # Convert to None if empty
            if not detailed_logs:
                detailed_logs = None

            update_stmt = self._build_completion_update_statement(
                JobExecution,
                completed_at,
                success,
                error_message,
                detailed_logs,
                status,
            )

            await self._execute_completion_update(db, update_stmt)
            self._completion_logged = True

            # Update local execution object state
            self.job_execution.completed_at = completed_at
            # Use explicit status if provided, otherwise derive from success
            self.job_execution.status = (
                status
                if status is not None
                else (JobStatus.SUCCESS if success else JobStatus.FAILED)
            )

        except Exception as e:
            await self._handle_completion_error(db, e)

    async def is_already_running(self, db: AsyncSession) -> bool:
        """Check if this job is already running.

        Uses in-memory runtime controls as the source of truth.
        If the DB has a RUNNING record but no runtime control exists,
        the record is orphaned and gets cleaned up automatically.

        Test runs use a separate runtime key so they never conflict
        with regular runs.
        """
        if is_runtime_job_running(self.runtime_key):
            logger.info(
                "Job is already running (runtime control active), skipping execution",
                job_config_id=self.job_config_id,
                runtime_key=self.runtime_key,
            )
            return True

        from sqlalchemy import select

        stmt = (
            select(JobExecution)
            .where(
                JobExecution.job_config_id == self.job_config_id,
                JobExecution.status.in_([JobStatus.RUNNING, JobStatus.PAUSED]),
                JobExecution.execution_type == self.execution_type,
            )
            .limit(1)
        )
        result = await db.execute(stmt)
        running_job = result.scalar_one_or_none()

        if running_job:
            logger.warning(
                "Found orphaned RUNNING/PAUSED execution without runtime control, cleaning up",
                job_config_id=self.job_config_id,
                orphaned_execution_id=running_job.id,
                running_since=(
                    running_job.started_at.isoformat()
                    if running_job.started_at
                    else None
                ),
            )
            running_job.status = JobStatus.FAILED
            running_job.completed_at = datetime.now(timezone.utc)
            running_job.error_message = (
                "Execution orphaned - no active runtime control found"
            )
            await self.safe_commit(db, "orphaned execution cleanup")

        return False

    async def handle_error(self, db: AsyncSession, error: Exception) -> str:
        """Handle job execution error and return formatted error message."""
        error_message = f"{type(error).__name__}: {str(error)}"

        logger.error(
            "Job execution failed",
            job_config_id=self.job_config_id,
            job_type=self.job_config.job_type.value if self.job_config else None,
            job_name=self.job_config.name if self.job_config else None,
            execution_id=self.job_execution_id,
            error=error_message,
            error_type=type(error).__name__,
        )
        return error_message

    @asynccontextmanager
    async def _db_session(self):
        async with db_manager.get_session() as session:
            yield session

    async def run(self) -> None:
        """Execute the job with proper error handling and logging."""
        async with self._db_session() as db:
            if await self.is_already_running(db):
                logger.info(
                    "Skipping job execution - already running",
                    job_config_id=self.job_config_id,
                )
                return

            try:
                await self.log_start(db)
            except Exception as error:
                logger.error(
                    "Failed to initialize job execution",
                    job_config_id=self.job_config_id,
                    error=str(error),
                    error_type=type(error).__name__,
                )
                return

            register_runtime_control(
                self.runtime_key,
                asyncio.current_task(),
            )

            try:
                # Load fresh configuration before execution
                await self._refresh_config(db)
                if self.job_config is None:
                    raise RuntimeError(
                        f"Job configuration {self.job_config_id} was not loaded"
                    )
                job_config = self.job_config

                if self.job_execution:
                    structlog_contextvars.bind_contextvars(
                        job_execution_id=self.job_execution_id,
                        job_name=job_config.name,
                        job_type=job_config.job_type.value,
                    )

                if is_riot_writer_maintenance_active(job_config, self.execution_type):
                    logger.warning(
                        "Regular Riot writer skipped during local maintenance",
                        job_config_id=self.job_config_id,
                        job_name=job_config.name,
                        job_type=job_config.job_type.value,
                    )
                    self.add_log_entry("riot_maintenance_blocked", True)
                    raise JobStopSignal(reason="riot_maintenance")

                await self.check_control_state(db)
                await self.execute(db)

            except JobStopSignal as stop_signal:
                self.add_log_entry("stopped_early", True)
                self.add_log_entry(
                    "stop_mode",
                    "force" if stop_signal.force else "graceful",
                )
                self.add_log_entry("stop_reason", stop_signal.reason)
                job_logs = self._get_job_logs()
                await self.log_completion(
                    db,
                    success=True,
                    logs=job_logs,
                    status=JobStatus.CANCELLED,
                )
            except asyncio.CancelledError:
                self.add_log_entry("stopped_early", True)
                self.add_log_entry("stop_mode", "force")
                job_logs = self._get_job_logs()
                await self.log_completion(
                    db,
                    success=True,
                    logs=job_logs,
                    status=JobStatus.CANCELLED,
                )
            except RateLimitSignal as rate_limit_signal:
                # Rate limit hit - save progress and mark as rate limited
                logger.warning(
                    "Job stopped due to rate limit",
                    job_config_id=self.job_config_id,
                    job_name=self.job_config.name if self.job_config else None,
                    retry_after=rate_limit_signal.retry_after,
                )
                job_logs = self._get_job_logs()
                await self.log_completion(
                    db,
                    success=True,  # Not a failure - completed what we could
                    logs=job_logs,
                    status=JobStatus.RATE_LIMITED,
                )
            except Exception as job_error:
                error_message = await self.handle_error(db, job_error)
                if self.has_api_key_error():
                    error_message = self._get_error_summary()
                job_logs = self._get_job_logs()
                await self.log_completion(
                    db,
                    success=False,
                    error_message=error_message,
                    logs=job_logs,
                )
            else:
                # API-key rejection is fatal. Regular writer jobs may classify
                # isolated per-player/provider errors as successful warnings,
                # while health-check jobs retain fail-on-any-error semantics.
                job_logs = self._get_job_logs()
                if self.has_api_key_error() or (
                    self.has_errors() and self.recorded_errors_are_fatal
                ):
                    error_summary = self._get_error_summary()
                    await self.log_completion(
                        db,
                        success=False,
                        error_message=error_summary,
                        logs=job_logs,
                    )
                else:
                    if self.has_errors():
                        self.add_log_entry("completed_with_warnings", True)
                        self.add_log_entry(
                            "warning_count", len(self._errors_encountered)
                        )
                        self.add_log_entry(
                            "warning_summary", self._get_warning_summary()
                        )
                    await self.log_completion(
                        db,
                        success=True,
                        logs=job_logs,
                    )
            finally:
                await self._fail_unfinished_execution(db)
                unregister_runtime_control(self.runtime_key)
                structlog_contextvars.clear_contextvars()

    async def _fail_unfinished_execution(self, db: AsyncSession) -> None:
        """Close an execution whose completion logging never ran.

        An exception raised outside `execute()` — while collecting logs or
        writing completion — would otherwise leave the row `RUNNING` forever,
        so the next scheduled tick reports it as an orphan.
        """
        if self.job_execution_id is None or self._completion_logged:
            return

        logger.error(
            "Job execution ended without recorded completion",
            job_config_id=self.job_config_id,
            execution_id=self.job_execution_id,
        )
        try:
            await db.rollback()
            await db.execute(
                update(JobExecution)
                .where(JobExecution.id == self.job_execution_id)
                .values(
                    status=JobStatus.FAILED,
                    completed_at=datetime.now(timezone.utc),
                    error_message="Execution ended before completion was recorded",
                )
            )
            await db.commit()
        except Exception as error:
            logger.error(
                "Failed to close unfinished job execution",
                job_config_id=self.job_config_id,
                execution_id=self.job_execution_id,
                error_type=type(error).__name__,
            )

    async def check_control_state(self, db: AsyncSession) -> None:
        """Check pause/stop state and block while paused."""
        await self._refresh_config(db)
        runtime_state = get_runtime_control_snapshot(self.runtime_key)

        if runtime_state["force_stop_requested"]:
            raise JobStopSignal(force=True)

        if runtime_state["stop_requested"]:
            raise JobStopSignal(force=False)

        if not self.job_config or not self.job_config.is_paused:
            return

        logger.info(
            "Job paused, waiting for resume",
            job_config_id=self.job_config_id,
            runtime_key=self.runtime_key,
        )

        # Mark execution as PAUSED in the database
        await self._set_execution_status(db, JobStatus.PAUSED)

        while True:
            await asyncio.sleep(1)
            await self._refresh_config(db)
            runtime_state = get_runtime_control_snapshot(self.runtime_key)

            if runtime_state["force_stop_requested"]:
                raise JobStopSignal(force=True)

            if runtime_state["stop_requested"]:
                raise JobStopSignal(force=False)

            if self.job_config and not self.job_config.is_paused:
                logger.info(
                    "Job resumed",
                    job_config_id=self.job_config_id,
                )
                # Restore execution to RUNNING status
                await self._set_execution_status(db, JobStatus.RUNNING)
                return

    async def safe_commit(
        self,
        db: AsyncSession,
        operation: str = "database operation",
        on_success: Optional[Callable[[], None]] = None,
    ) -> bool:
        """Safely commit database changes with automatic rollback on failure.

        Executes optional callback only after successful commit.
        Returns True on success, False on failure (logs error automatically).
        """
        try:
            await db.commit()
            if on_success:
                on_success()
            return True
        except Exception as e:
            await db.rollback()
            logger.error(
                f"Failed to commit {operation}",
                error=str(e),
                error_type=type(e).__name__,
                job_config_id=self.job_config_id,
                execution_id=self.job_execution_id,
            )
            return False

    async def _set_execution_status(self, db: AsyncSession, status: JobStatus) -> None:
        """Update the current execution's status in the database."""
        if self.job_execution is None:
            return
        self.job_execution.status = status
        await self.safe_commit(db, f"set execution status to {status.value}")

    def _get_job_logs(self) -> List[Dict[str, Any]]:
        """Extract logs for this job execution."""
        if self.job_execution is None:
            return []

        return [
            entry
            for entry in job_log_capture.entries
            if entry.get("job_execution_id") == self.job_execution_id
        ]

    def _strip_redundant_fields(
        self, logs: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """Remove fields that are redundant in DB (already in job_execution table).

        Keep them in stdout for debugging, strip only before DB storage.
        Note: 'level' is NOT stripped because each log entry can have a different level.
        """
        redundant_fields = {
            "job_execution_id",
            "job_name",
            "job_type",
            "logger",
        }

        return [
            {k: v for k, v in entry.items() if k not in redundant_fields}
            for entry in logs
        ]

    def increment_metric(self, metric_name: str, count: int = 1) -> None:
        """Increment a metric counter."""
        self.metrics[metric_name] += count

    def record_error(
        self,
        error: Exception | str,
        *,
        operation: str = "job execution",
        context: Optional[Dict[str, Any]] = None,
        is_api_key_error: bool = False,
    ) -> None:
        """Record a safe, structured diagnostic for an execution error.

        Persisted diagnostics deliberately retain the operation, exception type,
        safe HTTP status and explicitly supplied identifiers, but never arbitrary
        exception text or provider response bodies.
        """
        source_error = diagnostic_error(error) if isinstance(error, Exception) else None
        error_type = type(source_error).__name__ if source_error else "RecordedError"
        diagnostic: Dict[str, Any] = {
            "operation": operation,
            "error_type": error_type,
        }

        status_code = getattr(source_error, "status_code", None)
        if isinstance(status_code, int):
            diagnostic["status_code"] = status_code

        validation_errors = getattr(source_error, "errors", None)
        if callable(validation_errors):
            locations: list[str] = []
            try:
                reported_errors = validation_errors()
                if isinstance(reported_errors, list):
                    for item in reported_errors:
                        if not isinstance(item, dict):
                            continue
                        location = item.get("loc")
                        if isinstance(location, tuple):
                            locations.append(".".join(str(part) for part in location))
            except Exception:
                locations = []
            if locations:
                diagnostic["validation_fields"] = locations[:5]

        if context:
            safe_context = {
                key: value
                for key, value in context.items()
                if isinstance(value, (str, int, float, bool)) and len(str(value)) <= 128
            }
            if safe_context:
                diagnostic["context"] = safe_context

        self._errors_encountered.append(diagnostic)
        persisted_errors = self.execution_log.setdefault("errors", [])
        if len(persisted_errors) < 20:
            persisted_errors.append(diagnostic)
        else:
            self.execution_log["errors_truncated"] = len(self._errors_encountered) - 20
        if is_api_key_error:
            self._has_api_key_error = True
        if isinstance(error, Exception) and is_riot_puuid_binding_error(error):
            self._has_puuid_binding_error = True

    def _get_error_summary(self) -> str:
        """Return an actionable, secret-safe completion summary."""
        if self._has_api_key_error:
            return "API key error: Invalid or expired Riot API key"

        count = len(self._errors_encountered)
        first_error = self._errors_encountered[0]
        operation = first_error["operation"]
        error_type = first_error["error_type"]
        return (
            f"Job completed with {count} error(s); first failure: "
            f"{operation} ({error_type})"
        )

    def _get_warning_summary(self) -> str:
        """Return a concise completion summary for recoverable diagnostics."""
        count = len(self._errors_encountered)
        first_error = self._errors_encountered[0]
        return (
            f"Job completed with {count} warning(s); first warning: "
            f"{first_error['operation']} ({first_error['error_type']})"
        )

    async def get_job_riot_api_key(self, db: AsyncSession) -> str:
        """Load a Riot key and classify missing configuration as a key failure."""
        from app.core.config import get_riot_api_key
        from app.core.riot_api.errors import AuthenticationError

        try:
            return await get_riot_api_key(db)
        except ValueError as error:
            self.record_error(
                error,
                operation="Riot API key lookup",
                is_api_key_error=True,
            )
            raise AuthenticationError("No active Riot API key configured") from error

    def has_errors(self) -> bool:
        """Check if any errors were encountered during execution."""
        return len(self._errors_encountered) > 0

    def has_api_key_error(self) -> bool:
        """Check if an API key error was encountered."""
        return self._has_api_key_error

    def has_puuid_binding_error(self) -> bool:
        """Check whether Riot rejected a PUUID from another developer account."""
        return self._has_puuid_binding_error

    def add_log_entry(self, key: str, value: Any) -> None:
        """Add an entry to the execution log."""
        self.execution_log[key] = value

    # Private helper methods

    def _log_completion_details(self, success: bool, duration: float) -> None:
        """Log completion details to structured logger."""
        if self.job_config is None or self.job_execution is None:
            raise RuntimeError("Job context missing during completion logging")

        job_config = self.job_config

        logger.debug(
            "Job execution completed",
            job_config_id=self.job_config_id,
            job_type=job_config.job_type.value,
            job_name=job_config.name,
            execution_id=self.job_execution_id,
            status=JobStatus.SUCCESS.value if success else JobStatus.FAILED.value,
            duration_seconds=duration,
            api_requests=self.metrics["api_requests_made"],
            records_created=self.metrics["records_created"],
            records_updated=self.metrics["records_updated"],
            success=success,
        )

    def _build_completion_update_statement(
        self,
        job_execution_model,
        completed_at,
        success,
        error_message,
        detailed_logs,
        status=None,
    ):
        """Build SQLAlchemy update statement for job completion."""
        from sqlalchemy import update

        if self.job_execution is None:
            raise RuntimeError("Job execution is missing during completion update")

        # Use explicit status if provided, otherwise derive from success
        final_status = (
            status
            if status is not None
            else (JobStatus.SUCCESS if success else JobStatus.FAILED)
        )

        return (
            update(job_execution_model)
            .where(job_execution_model.id == self.job_execution_id)
            .values(
                completed_at=completed_at,
                status=final_status,
                api_requests_made=self.metrics["api_requests_made"],
                records_created=self.metrics["records_created"],
                records_updated=self.metrics["records_updated"],
                error_message=error_message,
                execution_log=self.execution_log,
                detailed_logs=detailed_logs,
                has_api_key_error=self._has_api_key_error,
            )
        )

    async def _execute_completion_update(self, db: AsyncSession, stmt) -> None:
        """Execute the completion update with retry logic."""
        execution_id = self.job_execution_id

        try:
            await db.execute(stmt)
            if await self.safe_commit(db, "job completion"):
                return
        except Exception as execute_error:
            logger.error(
                "Failed to execute job completion update",
                job_config_id=self.job_config_id,
                execution_id=execution_id,
                error=str(execute_error),
                error_type=type(execute_error).__name__,
            )

        # Retry once after rollback
        try:
            await db.rollback()
            await db.execute(stmt)
            if await self.safe_commit(db, "job completion retry"):
                logger.info(
                    "Successfully committed job completion on retry",
                    execution_id=execution_id,
                )
            else:
                logger.warning(
                    "Job completion retry commit failed - job may remain stuck",
                    execution_id=execution_id,
                )
        except Exception as retry_error:
            logger.error(
                "Failed to execute job completion retry - job may remain stuck",
                job_config_id=self.job_config_id,
                execution_id=execution_id,
                error=str(retry_error),
                error_type=type(retry_error).__name__,
            )
            # Don't raise - we want the job to complete even if logging fails

    async def _handle_completion_error(
        self, db: AsyncSession, error: Exception
    ) -> None:
        """Handle errors that occur during completion logging."""
        logger.error(
            "Failed to log job completion",
            job_config_id=self.job_config_id,
            execution_id=self.job_execution_id,
            error=str(error),
            error_type=type(error).__name__,
            exc_info=True,
        )
        try:
            await db.rollback()
        except Exception as rollback_error:
            logger.error(
                "Failed to rollback after log_completion error",
                error=str(rollback_error),
            )
