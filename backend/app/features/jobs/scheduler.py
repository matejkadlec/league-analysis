"""Scheduler module for managing automated background jobs."""

from datetime import datetime
from typing import Any, Dict, Optional, Type

import structlog
from apscheduler.executors.asyncio import AsyncIOExecutor
from apscheduler.jobstores.base import JobLookupError
from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import db_manager, get_global_settings

from .base import BaseJob
from .models import JobConfiguration, JobExecution, JobStatus, JobType

logger = structlog.get_logger(__name__)

# Global scheduler instance
_scheduler: Optional[AsyncIOScheduler] = None
_JOB_REGISTRY: Optional[Dict[JobType, Type[BaseJob]]] = None


def _get_job_registry() -> Dict[JobType, Type[BaseJob]]:
    global _JOB_REGISTRY
    if _JOB_REGISTRY is None:
        from .implementations.match_fetcher import MatchFetcherJob
        from .implementations.player_updater import PlayerUpdaterJob

        _JOB_REGISTRY = {
            JobType.MATCH_FETCHER: MatchFetcherJob,
            JobType.PLAYER_UPDATER: PlayerUpdaterJob,
        }

    return _JOB_REGISTRY


def get_scheduler() -> Optional[AsyncIOScheduler]:
    """Get the global scheduler instance.

    Returns:
        The scheduler instance if initialized, None otherwise.
    """
    return _scheduler


def _resolve_interval_seconds(job_config: JobConfiguration) -> int:
    """Determine interval seconds for a job configuration.

    :param job_config: Job configuration with schedule settings.
    :returns: Interval in seconds (minimum 1).
    :raises ValueError: If no valid interval configuration found.
    """
    config = job_config.config_json or {}
    custom_value = config.get("interval_seconds")

    # Try to parse custom value from config
    interval_from_config = _parse_interval_from_config(custom_value)
    if interval_from_config:
        return interval_from_config

    # Try to parse from schedule string
    schedule = (job_config.schedule or "").strip().lower()
    interval_from_schedule = _parse_interval_from_schedule(schedule)
    if interval_from_schedule:
        return interval_from_schedule

    # No valid configuration found - fail hard
    raise ValueError(
        f"No valid interval configuration found for job '{job_config.name}'. "
        f"Either set 'interval_seconds' in config_json or provide a valid schedule string."
    )


def _parse_interval_from_config(custom_value: Any) -> Optional[int]:
    """Parse interval from config JSON value.

    :param custom_value: Value from config_json['interval_seconds'].
    :returns: Parsed interval in seconds, or None if invalid.
    """
    # Exit early if no value provided
    if not custom_value:
        return None

    # Convert string digits to int
    if isinstance(custom_value, str) and custom_value.isdigit():
        custom_value = int(custom_value)

    # Return if valid positive integer
    if isinstance(custom_value, int) and custom_value > 0:
        return custom_value

    return None


def _parse_interval_from_schedule(schedule: str) -> Optional[int]:
    """Parse interval from schedule string.

    Supports formats:
    - "60" - plain number
    - "interval:60" - interval prefix
    - "60s" - seconds suffix

    :param schedule: Schedule string from job configuration.
    :returns: Parsed interval in seconds (minimum 1), or None if invalid.
    """
    # Exit early if empty
    if not schedule:
        return None

    # Try plain digit format: "60"
    if schedule.isdigit():
        return max(int(schedule), 1)

    # Try "interval:60" format
    if schedule.startswith("interval:"):
        candidate = schedule.split(":", 1)[1].strip()
        if candidate.isdigit():
            return max(int(candidate), 1)

    # Try "60s" format
    if schedule.endswith("s") and schedule[:-1].isdigit():
        return max(int(schedule[:-1]), 1)

    return None


async def _mark_stale_jobs_as_failed(db: AsyncSession) -> None:
    """Mark jobs that are stuck in 'running' state as failed on startup.

    This handles cases where jobs were running when the application was
    shut down ungracefully. On startup, we mark ALL running jobs as failed
    since no jobs should be running during application startup.

    Also resets is_paused on all job configurations, since pause state is a
    runtime concept that becomes meaningless after a restart.

    Args:
        db: Database session for updating job records.
    """
    try:
        from sqlalchemy import select, update

        # Reset is_paused on ALL job configurations — pause is a runtime-only
        # concept and must not survive across restarts.
        reset_paused_stmt = (
            update(JobConfiguration)
            .where(JobConfiguration.is_paused.is_(True))
            .values(is_paused=False)
        )
        pause_result = await db.execute(reset_paused_stmt)
        rows_reset = pause_result.rowcount or 0  # type: ignore[union-attr]
        if rows_reset:
            logger.info(
                "Reset paused state on job configurations at startup",
                count=rows_reset,
            )

        # Find ALL running or paused jobs (none should exist during startup)
        stmt = select(JobExecution).where(
            JobExecution.status.in_([JobStatus.RUNNING, JobStatus.PAUSED])
        )
        result = await db.execute(stmt)
        stale_jobs = result.scalars().all()

        if stale_jobs:
            logger.warning(
                "Found jobs stuck in running/paused state on startup",
                count=len(stale_jobs),
                job_ids=[job.id for job in stale_jobs],
            )

            # Update them to cancelled status — they were interrupted by shutdown
            update_stmt = (
                update(JobExecution)
                .where(JobExecution.status.in_([JobStatus.RUNNING, JobStatus.PAUSED]))
                .values(
                    status=JobStatus.CANCELLED,
                    completed_at=datetime.now(),
                    error_message="Job cancelled - was still running during application startup (likely ungraceful shutdown or crash)",
                )
            )
            await db.execute(update_stmt)
            await db.commit()

            logger.info(
                "Marked stale jobs as cancelled",
                count=len(stale_jobs),
            )
        else:
            await db.commit()
            logger.info("No stale jobs found on startup")

    except Exception as e:
        logger.error(
            "Failed to mark stale jobs as failed",
            error=str(e),
            error_type=type(e).__name__,
        )
        await db.rollback()


async def start_scheduler() -> AsyncIOScheduler:
    """Initialize and start the APScheduler instance.

    This function:
    1. Checks if scheduler should be enabled via configuration
    2. Creates scheduler with SQLAlchemy job store
    3. Marks stale running jobs as failed
    4. Starts the scheduler
    5. Loads job configurations from database and schedules them

    Returns:
        The initialized and started scheduler instance.

    Raises:
        Exception: If scheduler initialization fails.
    """
    global _scheduler

    settings = get_global_settings()

    if _scheduler is not None:
        logger.warning("Scheduler already initialized")
        return _scheduler

    try:
        logger.info("Initializing job scheduler")

        # Construct synchronous database URL for APScheduler's SQLAlchemyJobStore
        # APScheduler uses synchronous psycopg2, not async asyncpg
        # Store APScheduler jobs in jobs schema
        jobstore_url = f"postgresql+psycopg2://{settings.postgres_user}:{settings.postgres_password}@{settings.postgres_host}:{settings.postgres_port}/{settings.postgres_db}"

        # Configure job stores (APScheduler stores job state in jobs.apscheduler_jobs)
        jobstores = {
            "default": SQLAlchemyJobStore(
                url=jobstore_url, tablename="apscheduler_jobs", tableschema="jobs"
            ),
        }

        # Configure executors (how jobs are executed)
        executors = {
            "default": AsyncIOExecutor(),  # Async executor for our async jobs
        }

        # Configure job defaults
        job_defaults = {
            "coalesce": True,  # Combine multiple missed runs into one
            "max_instances": 1,  # Only one instance of each job at a time
            "misfire_grace_time": 60,  # Allow 60 seconds grace for missed jobs
        }

        # Create scheduler
        _scheduler = AsyncIOScheduler(
            jobstores=jobstores,
            executors=executors,
            job_defaults=job_defaults,
            timezone="UTC",
        )

        # Mark stale jobs as failed before starting
        async with db_manager.get_session() as db:
            await _mark_stale_jobs_as_failed(db)

        # Start the scheduler
        _scheduler.start()

        logger.info(
            "Job scheduler started successfully",
        )

        # Check for and run any overdue jobs
        await _check_and_run_overdue_jobs()

        # Load and schedule job configurations from database
        await _load_and_schedule_jobs()

        return _scheduler

    except Exception as e:
        logger.error(
            "Failed to start job scheduler",
            error=str(e),
            error_type=type(e).__name__,
        )
        _scheduler = None
        raise


def _convert_job_type(job_config: JobConfiguration) -> Optional[JobType]:
    """Convert job configuration type to JobType enum.

    :param job_config: Job configuration to convert.
    :returns: JobType enum, or None if invalid.
    """
    job_type = job_config.job_type
    if isinstance(job_type, str):
        try:
            return JobType(job_type)
        except ValueError:
            logger.warning(
                "Invalid job type, skipping",
                job_type=job_config.job_type,
                job_name=job_config.name,
            )
            return None
    return job_type


def _get_job_class(job_type: JobType, job_config: JobConfiguration, registry: Dict):
    """Get job class from registry.

    :param job_type: Type of job to get.
    :param job_config: Job configuration for logging.
    :param registry: Job registry mapping.
    :returns: Job class, or None if not found.
    """
    job_class = registry.get(job_type)
    if not job_class:
        logger.warning(
            "Unknown job type, skipping",
            job_type=job_type.value if isinstance(job_type, JobType) else str(job_type),
            job_name=job_config.name,
        )
    return job_class


def _schedule_job(
    job_config: JobConfiguration, job_class: Type[BaseJob], interval_seconds: int
):
    """Schedule a single job with the scheduler.

    :param job_config: Job configuration.
    :param job_class: Job class to instantiate.
    :param interval_seconds: Interval in seconds.
    """
    job_instance = job_class(job_config.id)
    job_type = job_config.job_type

    if _scheduler is None:
        raise RuntimeError("Scheduler is not initialized")

    _scheduler.add_job(
        job_instance.run,
        trigger="interval",
        seconds=interval_seconds,
        id=f"job_{job_config.id}",
        name=job_config.name,
        replace_existing=True,
    )

    logger.info(
        "Scheduled job",
        job_id=job_config.id,
        job_name=job_config.name,
        job_type=job_type.value if isinstance(job_type, JobType) else str(job_type),
        interval_seconds=interval_seconds,
    )


async def sync_job_configuration(job_config_id: int) -> None:
    """Sync a single job configuration with the running scheduler.

    - Active job: schedule or reschedule with current settings
    - Inactive/missing job: remove scheduled task if it exists
    """
    if _scheduler is None:
        logger.debug(
            "Scheduler not initialized, skipping job sync",
            job_config_id=job_config_id,
        )
        return

    scheduler_job_id = f"job_{job_config_id}"

    try:
        from sqlalchemy import select

        async with db_manager.get_session() as db:
            stmt = select(JobConfiguration).where(JobConfiguration.id == job_config_id)
            result = await db.execute(stmt)
            job_config = result.scalar_one_or_none()

        if job_config is None or not job_config.is_active:
            try:
                _scheduler.remove_job(scheduler_job_id)
                logger.info(
                    "Removed job from scheduler",
                    job_id=job_config_id,
                    reason="inactive_or_missing",
                )
            except JobLookupError:
                logger.debug(
                    "Job not present in scheduler during removal",
                    job_id=job_config_id,
                )
            return

        registry = _get_job_registry()
        job_type = _convert_job_type(job_config)
        if not job_type:
            return

        job_class = _get_job_class(job_type, job_config, registry)
        if not job_class:
            return

        interval_seconds = _resolve_interval_seconds(job_config)
        _schedule_job(job_config, job_class, interval_seconds)

    except Exception as e:
        logger.error(
            "Failed to sync job configuration with scheduler",
            job_id=job_config_id,
            error=str(e),
            error_type=type(e).__name__,
        )


async def _check_and_run_overdue_jobs() -> None:
    """Check for overdue jobs and run them immediately at startup.

    This handles the case where the server was offline longer than the job interval.
    Jobs are considered overdue if:
    - They have never run before (no executions), OR
    - Their last execution was longer ago than their interval

    Both jobs can run in parallel since they are async.
    """
    try:
        logger.info("Checking for overdue jobs at startup")
        from datetime import timezone

        from sqlalchemy import select

        async with db_manager.get_session() as db:
            stmt = select(JobConfiguration).where(JobConfiguration.is_active)
            result = await db.execute(stmt)
            job_configs = result.scalars().all()

        if not job_configs:
            logger.info("No active jobs to check")
            return

        registry = _get_job_registry()
        overdue_jobs = []

        # Get current time with UTC timezone
        now = datetime.now(timezone.utc)

        for job_config in job_configs:
            try:
                job_type = _convert_job_type(job_config)
                if not job_type:
                    continue

                job_class = _get_job_class(job_type, job_config, registry)
                if not job_class:
                    continue

                interval_seconds = _resolve_interval_seconds(job_config)

                # Check last execution
                async with db_manager.get_session() as db:
                    stmt = (
                        select(JobExecution)
                        .where(JobExecution.job_config_id == job_config.id)
                        .order_by(JobExecution.started_at.desc())
                        .limit(1)
                    )
                    result = await db.execute(stmt)
                    last_execution = result.scalar_one_or_none()

                # Determine if job is overdue
                is_overdue = False
                reason = ""

                if last_execution is None:
                    is_overdue = True
                    reason = "never run before"
                else:
                    time_since_last_run = (
                        now - last_execution.started_at
                    ).total_seconds()
                    if time_since_last_run > interval_seconds:
                        is_overdue = True
                        reason = f"last run {int(time_since_last_run / 60)} minutes ago (interval: {int(interval_seconds / 60)} minutes)"

                if is_overdue:
                    logger.info(
                        "Job is overdue, will run at startup",
                        job_name=job_config.name,
                        reason=reason,
                    )
                    overdue_jobs.append((job_config, job_class))

            except Exception as e:
                logger.error(
                    "Error checking if job is overdue",
                    job_name=job_config.name,
                    error=str(e),
                )
                continue

        # Run all overdue jobs in parallel
        if overdue_jobs:
            logger.info("Running overdue jobs at startup", count=len(overdue_jobs))

            import asyncio

            tasks = []
            for job_config, job_class in overdue_jobs:
                job_instance = job_class(job_config.id, triggered_by="system")
                tasks.append(asyncio.create_task(job_instance.run()))

            # Wait for all jobs to complete
            await asyncio.gather(*tasks, return_exceptions=True)

            logger.info("Completed running overdue jobs at startup")
        else:
            logger.info("No overdue jobs found at startup")

    except Exception as e:
        logger.error(
            "Failed to check and run overdue jobs",
            error=str(e),
            error_type=type(e).__name__,
        )
        # Don't raise - this is not critical for scheduler startup


async def _load_and_schedule_jobs() -> None:
    """Load job configurations from database and schedule them.

    This function queries active job configurations and schedules them
    with the appropriate job classes.
    """
    if _scheduler is None:
        logger.warning("Cannot load jobs, scheduler not initialized")
        return

    try:
        logger.info("Loading job configurations from database")
        from sqlalchemy import select

        async with db_manager.get_session() as db:
            stmt = select(JobConfiguration).where(JobConfiguration.is_active)
            result = await db.execute(stmt)
            job_configs = result.scalars().all()

        if not job_configs:
            logger.info("No active job configurations found")
            return

        registry = _get_job_registry()

        for job_config in job_configs:
            job_type = _convert_job_type(job_config)
            if not job_type:
                continue

            job_class = _get_job_class(job_type, job_config, registry)
            if not job_class:
                continue

            interval_seconds = _resolve_interval_seconds(job_config)
            _schedule_job(job_config, job_class, interval_seconds)

        logger.info("Successfully loaded and scheduled jobs", count=len(job_configs))

    except Exception as e:
        logger.error(
            "Failed to load and schedule jobs",
            error=str(e),
            error_type=type(e).__name__,
        )
        # Don't raise - scheduler can still run manually triggered jobs


async def shutdown_scheduler() -> None:
    """Gracefully shutdown the scheduler.

    This function:
    1. Waits for running jobs to complete
    2. Shuts down the scheduler
    3. Cleans up resources
    """
    global _scheduler

    if _scheduler is None:
        logger.info("Scheduler is not running, nothing to shutdown")
        return

    try:
        logger.info("Shutting down job scheduler")

        # Wait for running jobs to complete (with timeout)
        _scheduler.shutdown(wait=True)

        _scheduler = None

        logger.info("Job scheduler shut down successfully")

    except Exception as e:
        logger.error(
            "Error during scheduler shutdown",
            error=str(e),
            error_type=type(e).__name__,
        )
        raise
