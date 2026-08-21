# APScheduler 3.x ships neither stubs nor a `py.typed` marker, and the rule is
# "none" project-wide in `pyproject.toml`; the `strict` header above resets it
# to the strict default, so restore the project setting here.
# pyright: reportMissingTypeStubs=false
"""Scheduler module for managing automated background jobs."""

from collections.abc import Callable
from datetime import UTC, datetime
from typing import Protocol

import structlog
from apscheduler.executors.asyncio import AsyncIOExecutor
from apscheduler.jobstores.base import JobLookupError
from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import db_manager, get_global_settings
from app.core.config import Settings

from .base import BaseJob
from .intervals import JobIntervalError, resolve_interval_seconds
from .models import JobConfiguration, JobExecution, JobStatus, JobType

logger = structlog.get_logger(__name__)


class ScheduledJobLike(Protocol):
    """The slice of an APScheduler job the status endpoint reads."""

    @property
    def next_run_time(self) -> datetime | None: ...


class SchedulerLike(Protocol):
    """The slice of APScheduler's scheduler this module and the router drive.

    APScheduler is unannotated, so every call through the concrete class comes
    back as `Unknown`. Naming the surface we actually use pins the argument and
    return types at the boundary, and lets the test doubles that already stand
    in for the scheduler be checked against the same shape.
    """

    @property
    def running(self) -> bool: ...

    def start(self, paused: bool = False) -> None: ...

    def shutdown(self, wait: bool = True) -> None: ...

    def resume(self) -> None: ...

    # APScheduler funnels trigger arguments through `**trigger_args`, where they
    # collide with its own `jobstore`/`executor` keywords. Naming the two this
    # module actually passes keeps the boundary typed: `seconds` for the
    # recurring interval schedules, `run_date` for one-shot catch-up entries.
    def add_job(
        self,
        func: Callable[..., object],
        trigger: str | None = None,
        *,
        id: str | None = None,
        name: str | None = None,
        replace_existing: bool = False,
        seconds: int | None = None,
        run_date: datetime | None = None,
    ) -> object: ...

    def get_jobs(self) -> list[ScheduledJobLike]: ...

    # `jobstore` is deliberately absent from these four. APScheduler accepts it,
    # but nothing here passes it, and a Protocol is meant to state what this
    # module actually depends on rather than mirror the concrete class.
    def remove_job(self, job_id: str) -> None: ...

    def remove_all_jobs(self) -> None: ...

    def pause_job(self, job_id: str) -> object: ...

    def resume_job(self, job_id: str) -> object: ...


# Global scheduler instance
_scheduler: SchedulerLike | None = None
_job_registry: dict[JobType, type[BaseJob]] | None = None


def job_registry() -> dict[JobType, type[BaseJob]]:
    """The one map from a declared job type to the class that runs it.

    Built on first use so importing the scheduler does not drag in every
    service an implementation touches. The router asks for it too, rather
    than keeping a second copy that a new job type could be missing from.
    """
    global _job_registry
    if _job_registry is None:
        from .implementations.match_fetcher import MatchFetcherJob
        from .implementations.player_updater import PlayerUpdaterJob

        _job_registry = {
            JobType.MATCH_FETCHER: MatchFetcherJob,
            JobType.PLAYER_UPDATER: PlayerUpdaterJob,
        }

    return _job_registry


def get_scheduler() -> SchedulerLike | None:
    """Get the global scheduler instance.

    Returns:
        The scheduler instance if initialized, None otherwise.
    """
    return _scheduler


def _resolve_interval_seconds(job_config: JobConfiguration) -> int:
    """Determine interval seconds for a job configuration.

    :raises JobIntervalError: If no valid interval configuration found.
    """
    return resolve_interval_seconds(
        name=job_config.name,
        schedule=job_config.schedule,
        config_json=job_config.config_json,
    )


class StartupRecoveryError(RuntimeError):
    """A mandatory startup recovery step did not complete.

    Serving after this would look healthy while leaving every active player
    sync row stranded, so it must reach the application lifespan rather than
    being logged and forgotten.
    """


async def _run_startup_recovery() -> None:
    """Reclassify persisted state left behind by a previous process.

    Each step owns a separate session, and the whole block around each one is
    shielded, so neither a step's own failure nor a failure while its session
    rolls back or closes may skip the step that follows. Every step therefore
    runs before any failure is raised.

    Cancelling orphaned player syncs is mandatory. A stranded active row is
    handed back to the next request with `created=False`, so no worker is
    scheduled and the client polls `pending` forever without ever seeing a
    terminal error. Failing startup is the honest outcome: production runs
    `restart: unless-stopped`, so a transient fault gets a clean retry.

    Raises:
        StartupRecoveryError: If a mandatory step failed.
    """
    # (step, mandatory). Mandatory is an explicit flag rather than a name match,
    # so the decision cannot drift when a step is renamed or wrapped.
    steps = (
        ("job executions", _mark_stale_jobs_as_failed, False),
        ("orphaned player syncs", _cancel_orphaned_player_syncs, True),
    )
    blocking: list[str] = []

    for label, step, is_mandatory in steps:
        try:
            async with db_manager.get_session() as db:
                await step(db)
        except Exception as error:
            if is_mandatory:
                blocking.append(label)
            logger.error(
                "Startup recovery step failed",
                step=label,
                mandatory=is_mandatory,
                error=str(error),
                error_type=type(error).__name__,
            )

    if blocking:
        raise StartupRecoveryError(
            f"Mandatory startup recovery failed: {', '.join(blocking)}"
        )


async def _cancel_orphaned_player_syncs(db: AsyncSession) -> None:
    """Close player sync runs whose in-process worker did not survive.

    `jobs.player_sync_runs` is driven by an in-process worker, so no row left
    active by a previous process can still be owned. The table allows one active
    row per PUUID and `start_player_sync` hands back an existing active row
    while the route schedules work only for a newly created one, so an orphan
    blocks that player's updates until something closes it.

    Startup is the only safe place to do this. A live process cannot tell an
    abandoned row apart from one a running worker still owns, and no Riot
    identity is involved here, so nothing has to be matched by Riot ID.

    `core.matchmaking_analyses` is deliberately excluded. It has the opposite
    contract: `start_analysis` attaches to an active row and relaunches its
    worker, preserving completed progress across a restart. Cancelling it here
    would discard that progress. See
    [`docs/matchmaking-analysis.md`](../../../../docs/matchmaking-analysis.md).

    A failure rolls back and propagates, because serving with rows still
    stranded looks healthy while every affected player polls forever.

    Args:
        db: Database session for updating the player sync records.

    Raises:
        Exception: Whatever the update or commit raised, after rolling back.
    """

    from sqlalchemy import update

    from .models import PlayerSyncRun
    from .player_sync import ACTIVE_SYNC_STATUSES

    try:
        now = datetime.now(UTC)
        result = await db.execute(
            update(PlayerSyncRun)
            .where(PlayerSyncRun.status.in_(ACTIVE_SYNC_STATUSES))
            .values(
                status="cancelled",
                completed_at=now,
                # A Core update bypasses the model's application-side onupdate.
                updated_at=now,
                error_code="SYNC_CANCELLED",
                error_message="The player update was cancelled before it finished.",
            )
        )
        await db.commit()
    except Exception as error:
        logger.error(
            "Failed to cancel player sync runs orphaned by a restart",
            error=str(error),
            error_type=type(error).__name__,
        )
        await db.rollback()
        raise

    cancelled = result.rowcount or 0  # type: ignore[union-attr]
    if cancelled:
        logger.info(
            "Cancelled player sync runs orphaned by a restart",
            player_sync_runs=cancelled,
        )


async def _mark_stale_jobs_as_failed(db: AsyncSession) -> None:
    """Mark jobs that are stuck in 'running' state as failed on startup.

    This handles cases where jobs were running when the application was
    shut down ungracefully. On startup, we mark ALL running jobs as failed
    since no jobs should be running during application startup.

    Args:
        db: Database session for updating job records.
    """
    try:
        from sqlalchemy import select, update

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
                    completed_at=datetime.now(UTC),
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


def _build_scheduler(settings: Settings) -> SchedulerLike:
    """Construct the APScheduler instance behind the `SchedulerLike` boundary.

    Returning the protocol rather than `AsyncIOScheduler` is what keeps the
    caller from inheriting the unannotated concrete class.
    """
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

    return AsyncIOScheduler(
        jobstores=jobstores,
        executors=executors,
        job_defaults=job_defaults,
        timezone="UTC",
    )


async def start_scheduler() -> SchedulerLike:
    """Initialize and start the APScheduler instance.

    This function:
    1. Checks if scheduler should be enabled via configuration
    2. Creates scheduler with SQLAlchemy job store
    3. Marks stale running jobs as failed
    4. Starts the scheduler paused and replaces persisted scheduler entries
       from authoritative job configurations
    5. Queues each overdue job once, then resumes the scheduler

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

        _scheduler = _build_scheduler(settings)

        await _run_startup_recovery()

        # Open the persistent job store without allowing an overdue entry from
        # the previous process to dispatch. Rebuild every regular schedule from
        # the authoritative configurations before work is allowed to run.
        _scheduler.start(paused=True)
        _scheduler.remove_all_jobs()

        # Load and schedule job configurations from database
        await _load_and_schedule_jobs()

        # Queue each overdue configuration once. These are scheduler-owned
        # one-shot jobs, so application readiness never waits on Riot work.
        await _check_and_run_overdue_jobs()

        _scheduler.resume()

        logger.info(
            "Job scheduler started successfully",
        )

        return _scheduler

    except Exception as e:
        logger.error(
            "Failed to start job scheduler",
            error=str(e),
            error_type=type(e).__name__,
        )
        _scheduler = None
        raise


def _get_job_class(
    job_type: JobType,
    job_config: JobConfiguration,
    registry: dict[JobType, type[BaseJob]],
) -> type[BaseJob] | None:
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
            job_type=job_type.value,
            job_name=job_config.name,
        )
    return job_class


def _schedule_job(
    job_config: JobConfiguration, job_class: type[BaseJob], interval_seconds: int
):
    """Schedule a single job with the scheduler.

    :param job_config: Job configuration.
    :param job_class: Job class to instantiate.
    :param interval_seconds: Interval in seconds.
    """
    job_instance = job_class(job_config.id)

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
        job_type=job_config.job_type.value,
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

    registry = job_registry()
    job_class = _get_job_class(job_config.job_type, job_config, registry)
    if not job_class:
        return

    # No blanket handler. The one caller commits the configuration first, so
    # swallowing a fault here answered 200 for a row the scheduler had not
    # accepted; the update route now validates the interval before it commits,
    # which leaves only genuine scheduler faults -- worth a 500.
    _schedule_job(job_config, job_class, _resolve_interval_seconds(job_config))


def _overdue_reason(
    last_execution: JobExecution | None,
    now: datetime,
    interval_seconds: int,
) -> str | None:
    """Return the overdue reason, or None when the job is still on schedule."""
    if last_execution is None:
        return "never run before"
    time_since_last_run = (now - last_execution.started_at).total_seconds()
    if time_since_last_run > interval_seconds:
        return (
            f"last run {int(time_since_last_run / 60)} minutes ago "
            f"(interval: {int(interval_seconds / 60)} minutes)"
        )
    return None


async def _last_job_execution(job_config_id: int) -> JobExecution | None:
    """Return the most recent execution for one configuration, if any."""
    from sqlalchemy import select

    async with db_manager.get_session() as db:
        stmt = (
            select(JobExecution)
            .where(JobExecution.job_config_id == job_config_id)
            .order_by(JobExecution.started_at.desc())
            .limit(1)
        )
        result = await db.execute(stmt)
        return result.scalar_one_or_none()


async def _collect_overdue_jobs(
    job_configs: list[JobConfiguration],
    registry: dict[JobType, type[BaseJob]],
    now: datetime,
) -> list[tuple[JobConfiguration, type[BaseJob]]]:
    """Inspect active configurations and return those that need catch-up."""
    overdue_jobs: list[tuple[JobConfiguration, type[BaseJob]]] = []
    for job_config in job_configs:
        try:
            job_class = _get_job_class(job_config.job_type, job_config, registry)
            if not job_class:
                continue

            interval_seconds = _resolve_interval_seconds(job_config)
            last_execution = await _last_job_execution(job_config.id)
            reason = _overdue_reason(last_execution, now, interval_seconds)
            if reason is None:
                continue

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
    return overdue_jobs


def _queue_overdue_jobs(
    overdue_jobs: list[tuple[JobConfiguration, type[BaseJob]]],
    now: datetime,
) -> None:
    """Queue one-shot catch-up entries without awaiting provider work."""
    if _scheduler is None:
        raise RuntimeError("Scheduler is not initialized")

    logger.info("Queuing overdue jobs at startup", count=len(overdue_jobs))

    for job_config, job_class in overdue_jobs:
        job_instance = job_class(job_config.id, triggered_by="system")
        _scheduler.add_job(
            job_instance.run,
            trigger="date",
            run_date=now,
            id=f"startup_overdue_job_{job_config.id}",
            name=f"{job_config.name} startup catch-up",
            replace_existing=True,
        )

    logger.info("Queued overdue jobs at startup")


async def _check_and_run_overdue_jobs() -> None:
    """Check for overdue jobs and queue them once for immediate execution.

    This handles the case where the server was offline longer than the job interval.
    Jobs are considered overdue if:
    - They have never run before (no executions), OR
    - Their last execution was longer ago than their interval

    The scheduler is still paused while this function runs. One-shot entries
    are dispatched only after startup resumes the scheduler, so readiness does
    not wait on provider traffic or a rate-limit window.
    """
    try:
        logger.info("Checking for overdue jobs at startup")
        from sqlalchemy import select

        async with db_manager.get_session() as db:
            stmt = select(JobConfiguration).where(JobConfiguration.is_active)
            result = await db.execute(stmt)
            job_configs = result.scalars().all()

        if not job_configs:
            logger.info("No active jobs to check")
            return

        now = datetime.now(UTC)
        overdue_jobs = await _collect_overdue_jobs(
            list(job_configs), job_registry(), now
        )

        if overdue_jobs:
            _queue_overdue_jobs(overdue_jobs, now)
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

        registry = job_registry()

        scheduled = 0
        for job_config in job_configs:
            # Per row, like `_collect_overdue_jobs` already does. One
            # unresolvable configuration used to abort the loop, so every job
            # after it went unscheduled with a single log line as the trace.
            try:
                job_class = _get_job_class(job_config.job_type, job_config, registry)
                if not job_class:
                    continue

                interval_seconds = _resolve_interval_seconds(job_config)
                _schedule_job(job_config, job_class, interval_seconds)
                scheduled += 1
            except JobIntervalError as e:
                logger.error(
                    "Skipping job with an unusable interval",
                    job_name=job_config.name,
                    error=str(e),
                )

        logger.info("Successfully loaded and scheduled jobs", count=scheduled)

    except Exception as e:
        logger.error(
            "Failed to load and schedule jobs",
            error=str(e),
            error_type=type(e).__name__,
        )
        # Don't raise - scheduler can still run manually triggered jobs


async def shutdown_scheduler() -> None:
    """Stop accepting scheduled work without draining active executions.

    This function:
    1. Stops future scheduler dispatches
    2. Returns without waiting for long-running Riot work
    3. Lets startup recovery reconcile interrupted persisted executions
    """
    global _scheduler

    if _scheduler is None:
        logger.info("Scheduler is not running, nothing to shutdown")
        return

    try:
        logger.info("Shutting down job scheduler")

        # Never wait. A Riot execution can run for many minutes, and draining
        # one would stall every deployment for as long as it happens to have
        # left. Startup recovery owns whatever persisted state an interrupted
        # run leaves behind, so cutting it short is the recoverable choice.
        _scheduler.shutdown(wait=False)

        _scheduler = None

        logger.info("Job scheduler shut down successfully")

    except Exception as e:
        logger.error(
            "Error during scheduler shutdown",
            error=str(e),
            error_type=type(e).__name__,
        )
        raise
