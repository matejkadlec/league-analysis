# APScheduler 3.x ships neither stubs nor a `py.typed` marker. The rule is off
# project-wide in `pyproject.toml`; the `strict` header above resets it to the
# strict default, so restore the project setting here.
# pyright: reportMissingTypeStubs=false
"""Job management API endpoints."""

from typing import NoReturn

import structlog
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query

from app.features.auth.dependencies import get_current_admin_user

from .base import BaseJob
from .control import (
    is_runtime_job_running,
    request_job_stop,
    runtime_control_key,
)
from .dependencies import JobServiceDep
from .implementations.match_fetcher import MatchFetcherJob
from .implementations.player_updater import PlayerUpdaterJob
from .implementations.test_runner import TestMatchFetcherJob, TestPlayerUpdaterJob
from .intervals import JobIntervalError
from .maintenance import RiotWriterMaintenanceConfigurationError
from .models import ExecutionType, JobStatus, JobType
from .schemas import (
    JobConfigurationResponse,
    JobConfigurationUpdate,
    JobControlActionResponse,
    JobExecutionListResponse,
    JobStatusResponse,
    JobTriggerResponse,
)
from .service import JobService

logger = structlog.get_logger(__name__)

router = APIRouter(
    prefix="/jobs",
    tags=["jobs"],
    dependencies=[Depends(get_current_admin_user)],
)


def _raise_job_not_found(job_id: int) -> NoReturn:
    """The one 404 this router has, raised from six places.

    `NoReturn` is what lets the call sites keep narrowing: after
    `if not job: _raise_job_not_found(job_id)` the type checker still knows
    `job` is not None on the next line, exactly as the inline `raise` did.
    """
    raise HTTPException(
        status_code=404,
        detail=f"Job configuration with ID {job_id} not found",
    )


def _create_job_instance(
    job: JobConfigurationResponse, triggered_by: str = "system"
) -> BaseJob:
    """Create a job instance based on job type.

    Args:
        job: Job configuration response to build the runner for.
        triggered_by: Who triggered the job: 'system' (scheduler) or 'user' (manual).

    Returns:
        Job instance based on job type
    """
    job_type_mapping: dict[JobType, type[BaseJob]] = {
        JobType.MATCH_FETCHER: MatchFetcherJob,
        JobType.PLAYER_UPDATER: PlayerUpdaterJob,
    }

    job_class = job_type_mapping.get(job.job_type)
    if not job_class:
        raise HTTPException(
            status_code=501,
            detail=f"Job type {job.job_type} implementation not found.",
        )
    return job_class(job.id, triggered_by=triggered_by)


def _create_test_job_instance(
    job: JobConfigurationResponse,
) -> TestMatchFetcherJob | TestPlayerUpdaterJob:
    """Create a test job instance based on job type.

    Returns:
        Test job instance that calls API endpoints without writing data.
    """
    test_type_mapping: dict[
        JobType, type[TestMatchFetcherJob] | type[TestPlayerUpdaterJob]
    ] = {
        JobType.MATCH_FETCHER: TestMatchFetcherJob,
        JobType.PLAYER_UPDATER: TestPlayerUpdaterJob,
    }

    test_class = test_type_mapping.get(job.job_type)
    if not test_class:
        raise HTTPException(
            status_code=501,
            detail=f"Test runner for job type {job.job_type} not implemented.",
        )
    return test_class(job.id)


# === Job Configuration Endpoints ===


@router.get("/")
async def list_job_configurations(
    job_service: JobServiceDep,
    active_only: bool = Query(False, description="Filter to active jobs only"),
) -> list[JobConfigurationResponse]:
    """List all job configurations, optionally filtered to active jobs only."""
    jobs = await job_service.list_job_configurations(active_only=active_only)
    return jobs


@router.put("/{job_id}")
async def update_job_configuration(
    job_id: int,
    job_update: JobConfigurationUpdate,
    job_service: JobServiceDep,
) -> JobConfigurationResponse:
    """Update job configuration (e.g., enable/disable, change schedule)."""
    try:
        job = await job_service.update_job_configuration(job_id, job_update)
        if not job:
            _raise_job_not_found(job_id)

        # Keep APScheduler in sync with DB changes immediately.
        from .scheduler import sync_job_configuration

        await sync_job_configuration(job.id)
        return job
    except RiotWriterMaintenanceConfigurationError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except JobIntervalError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


# === Job Execution Endpoints ===


@router.get("/{job_id}/executions")
async def get_job_executions(
    job_id: int,
    job_service: JobServiceDep,
    page: int = Query(1, ge=1, description="Page number"),
    size: int = Query(20, ge=1, le=100, description="Page size"),
    status: JobStatus | None = Query(None, description="Filter by status"),
    execution_type: ExecutionType | None = Query(
        None, description="Filter by execution type"
    ),
) -> JobExecutionListResponse:
    """
    Get execution history for a specific job.

    Args:
        job_id: Job configuration ID.
        page: Page number (1-indexed).
        size: Number of executions per page.
        status: Optional status filter.
        execution_type: Optional execution type filter (REGULAR or TEST).

    Returns:
        Paginated list of job executions.
    """
    executions = await job_service.list_job_executions(
        job_config_id=job_id,
        status=status,
        execution_type=execution_type,
        page=page,
        size=size,
    )
    return executions


@router.get("/executions/all")
async def list_all_executions(
    job_service: JobServiceDep,
    page: int = Query(1, ge=1, description="Page number"),
    size: int = Query(20, ge=1, le=100, description="Page size"),
    status: JobStatus | None = Query(None, description="Filter by status"),
    execution_type: ExecutionType | None = Query(
        None, description="Filter by execution type"
    ),
) -> JobExecutionListResponse:
    """
    Get execution history for all jobs.

    Args:
        page: Page number (1-indexed).
        size: Number of executions per page.
        status: Optional status filter.
        execution_type: Optional execution type filter (REGULAR or TEST).

    Returns:
        Paginated list of all job executions.
    """
    executions = await job_service.list_job_executions(
        status=status,
        execution_type=execution_type,
        page=page,
        size=size,
    )
    return executions


# === Job Control Endpoints ===


@router.post("/{job_id}/trigger")
async def trigger_job(
    job_id: int,
    background_tasks: BackgroundTasks,
    job_service: JobServiceDep,
) -> JobTriggerResponse:
    """
    Manually trigger a job execution.

    This creates a new job execution record and triggers the job
    immediately, bypassing the normal schedule.

    Args:
        job_id: Job configuration ID.
        background_tasks: FastAPI background tasks for async execution.

    Returns:
        Job trigger response with execution ID.

    Raises:
        404: Job configuration not found.
        400: Job is not active or scheduler is disabled.
        409: Job is already running.
    """
    job = await job_service.get_job_configuration(job_id)
    if not job:
        _raise_job_not_found(job_id)

    if not job.is_active:
        raise HTTPException(
            status_code=400,
            detail=f"Job '{job.name}' is not active and cannot be triggered",
        )

    # If a test run is active (non-suspended), stop it so the real run
    # can proceed.
    test_runtime_key = runtime_control_key(job.id, test_run=True)
    if is_runtime_job_running(test_runtime_key):
        request_job_stop(test_runtime_key, force=True)
        logger.info(
            "Stopped test run to allow regular trigger",
            job_id=job_id,
        )

    # Check if job is already running (prevent concurrent runs)
    is_running = await job_service.is_job_running(job.job_type)
    if is_running:
        logger.info(
            "Job already running, skipping trigger",
            job_id=job_id,
            job_name=job.name,
            job_type=job.job_type.value,
        )
        return JobTriggerResponse(
            success=False,
            message=f"Job '{job.name}' is already running. Please wait for it to complete.",
            execution_id=None,
        )

    # Create and trigger the job instance (triggered by user)
    job_instance = _create_job_instance(job, triggered_by="user")
    background_tasks.add_task(job_instance.run)

    logger.info(
        "Job triggered manually",
        job_id=job_id,
        job_name=job.name,
        job_type=job.job_type.value,
    )

    return JobTriggerResponse(
        success=True,
        message=f"Job '{job.name}' triggered successfully",
        execution_id=None,  # Execution ID will be created by the job itself
    )


def _require_control_state(
    state: JobControlActionResponse | None, job_id: int
) -> JobControlActionResponse:
    """Turn a control-action result into the 404/409 the three routes share.

    `None` means the job configuration does not exist; a present-but-unsuccessful
    state means it exists and refused, which is a conflict rather than a miss.
    """
    if state is None:
        _raise_job_not_found(job_id)
    if not state.success:
        raise HTTPException(status_code=409, detail=state.message)
    return state


@router.post("/{job_id}/pause")
async def pause_job(
    job_id: int,
    job_service: JobServiceDep,
) -> JobControlActionResponse:
    """Pause a running job execution."""
    return _require_control_state(
        await job_service.set_job_paused(job_id, paused=True), job_id
    )


@router.post("/{job_id}/resume")
async def resume_job(
    job_id: int,
    job_service: JobServiceDep,
) -> JobControlActionResponse:
    """Resume a paused running job execution."""
    return _require_control_state(
        await job_service.set_job_paused(job_id, paused=False), job_id
    )


@router.post("/{job_id}/stop")
async def stop_job(
    job_id: int,
    job_service: JobServiceDep,
    force: bool = Query(False, description="Force stop immediately"),
) -> JobControlActionResponse:
    """Request graceful or forced stop for a running job execution."""
    return _require_control_state(
        await job_service.request_job_stop_action(job_id, force=force), job_id
    )


# === Test Run Endpoints ===


def _set_scheduled_job_suspended(job_id: int, *, suspended: bool) -> None:
    """Pause or resume `job_id`'s scheduled run around a test run.

    The scheduler import stays local, as both call sites had it. A job the
    scheduler never held raises `JobLookupError` — nothing to restore.
    """
    from apscheduler.jobstores.base import JobLookupError

    from .scheduler import get_scheduler

    scheduler = get_scheduler()
    scheduler_job_id = f"job_{job_id}"
    if not (scheduler and scheduler.running):
        return
    try:
        if suspended:
            scheduler.pause_job(scheduler_job_id)
        else:
            scheduler.resume_job(scheduler_job_id)
        logger.info(
            "Suspended scheduled runs for test"
            if suspended
            else "Resumed scheduled runs after test",
            job_id=job_id,
            scheduler_job_id=scheduler_job_id,
        )
    except JobLookupError:
        pass


@router.post("/{job_id}/test")
async def trigger_test_run(
    job_id: int,
    background_tasks: BackgroundTasks,
    job_service: JobServiceDep,
    suspend_regular: bool = Query(
        False,
        description="Whether to suspend regular scheduled runs during the test",
    ),
) -> JobTriggerResponse:
    """Start a test run for a job.

    The test run calls all Riot API endpoints the real job uses once per
    minute.  It never writes data to the database (except the execution
    record itself).  Runs for up to 1 hour or until stopped.

    Args:
        job_id: Job configuration ID.
        suspend_regular: If True, the scheduled job is paused for the duration.
    """
    job = await job_service.get_job_configuration(job_id)
    if not job:
        _raise_job_not_found(job_id)

    if not job.is_active:
        raise HTTPException(
            status_code=400,
            detail=f"Job '{job.name}' is not active and cannot be tested",
        )

    # Check if a test run is already active (negative key = test)
    test_runtime_key = runtime_control_key(job.id, test_run=True)
    if is_runtime_job_running(test_runtime_key):
        return JobTriggerResponse(
            success=False,
            message=f"A test run for '{job.name}' is already active.",
            execution_id=None,
        )

    # Suspend scheduled runs if requested
    if suspend_regular:
        _set_scheduled_job_suspended(job.id, suspended=True)

    test_instance = _create_test_job_instance(job)
    # Store suspend_regular flag so test completion can resume the scheduler
    test_instance.suspend_regular = suspend_regular
    background_tasks.add_task(
        _run_test_job_with_cleanup,
        test_instance,
        job.id,
        suspend_regular,
    )

    logger.info(
        "Test run triggered",
        job_id=job_id,
        job_name=job.name,
        suspend_regular=suspend_regular,
    )

    return JobTriggerResponse(
        success=True,
        message=f"Test run for '{job.name}' started",
        execution_id=None,
    )


async def _run_test_job_with_cleanup(
    test_instance: BaseJob,
    job_id: int,
    suspend_regular: bool,
) -> None:
    """Run the test job and resume the scheduler job when it finishes."""
    try:
        await test_instance.run()
    finally:
        if suspend_regular:
            _set_scheduled_job_suspended(job_id, suspended=False)


@router.post("/{job_id}/test/stop")
async def stop_test_run(
    job_id: int,
    job_service: JobServiceDep,
    force: bool = Query(False, description="Force stop immediately"),
) -> JobControlActionResponse:
    """Stop a running test for a job."""
    state = await job_service.request_job_stop_action(
        job_id, force=force, test_run=True
    )
    if state is None:
        _raise_job_not_found(job_id)
    return state


async def _set_test_run_paused(
    job_id: int,
    job_service: JobService,
    *,
    paused: bool,
) -> JobControlActionResponse:
    """Flip the pause flag for an active test run; the two routes share this."""
    state = await job_service.set_job_paused(job_id, paused, test_run=True)
    if state is None:
        _raise_job_not_found(job_id)
    return state


@router.post("/{job_id}/test/pause")
async def pause_test_run(
    job_id: int,
    job_service: JobServiceDep,
) -> JobControlActionResponse:
    """Pause a running test execution."""
    return await _set_test_run_paused(job_id, job_service, paused=True)


@router.post("/{job_id}/test/resume")
async def resume_test_run(
    job_id: int,
    job_service: JobServiceDep,
) -> JobControlActionResponse:
    """Resume a paused test execution."""
    return await _set_test_run_paused(job_id, job_service, paused=False)


@router.get("/status/overview")
async def get_job_system_status(
    job_service: JobServiceDep,
) -> JobStatusResponse:
    """
    Get overall job system status.

    Returns:
        Job system status including scheduler state, active jobs,
        running executions, and last execution details.
    """
    from .scheduler import get_scheduler

    # Get metrics
    active_jobs = await job_service.get_active_job_count()
    running_executions = await job_service.get_running_execution_count()
    last_execution = await job_service.get_latest_execution()

    # Get actual scheduler status
    scheduler = get_scheduler()
    scheduler_running = scheduler is not None and scheduler.running

    next_run_time = None
    if scheduler is not None and scheduler_running:
        next_run_time = min(
            (
                job.next_run_time
                for job in scheduler.get_jobs()
                if job.next_run_time is not None
            ),
            default=None,
        )

    return JobStatusResponse(
        scheduler_running=scheduler_running,
        active_jobs=active_jobs,
        running_executions=running_executions,
        last_execution=last_execution,
        next_run_time=next_run_time,
    )
