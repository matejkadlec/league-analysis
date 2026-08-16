# APScheduler 3.x ships neither stubs nor a `py.typed` marker. The rule is off
# project-wide in `pyproject.toml`; the `strict` header above resets it to the
# strict default, so restore the project setting here.
# pyright: reportMissingTypeStubs=false
"""Job management API endpoints."""

from datetime import UTC, datetime

import structlog
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query

from app.features.auth.dependencies import get_current_admin_user

from .base import BaseJob
from .control import (
    get_runtime_control_snapshot,
    is_runtime_job_running,
    request_job_stop,
)
from .dependencies import JobServiceDep
from .implementations.match_fetcher import MatchFetcherJob
from .implementations.player_updater import PlayerUpdaterJob
from .implementations.test_runner import TestMatchFetcherJob, TestPlayerUpdaterJob
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

logger = structlog.get_logger(__name__)

router = APIRouter(
    prefix="/jobs",
    tags=["jobs"],
    dependencies=[Depends(get_current_admin_user)],
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
            detail="This job type is not supported.",
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
            detail="Test runs are not supported for this job type.",
        )
    return test_class(job.id)


# === Job Configuration Endpoints ===


@router.get("/", response_model=list[JobConfigurationResponse])
async def list_job_configurations(
    job_service: JobServiceDep,
    active_only: bool = Query(False, description="Filter to active jobs only"),
):
    """List all job configurations, optionally filtered to active jobs only."""
    try:
        jobs = await job_service.list_job_configurations(active_only=active_only)
        return jobs
    except Exception as e:
        logger.error("Failed to list job configurations", error=str(e), exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Job configurations could not be loaded. Please try again later.",
        ) from e


@router.put("/{job_id}", response_model=JobConfigurationResponse)
async def update_job_configuration(
    job_id: int,
    job_update: JobConfigurationUpdate,
    job_service: JobServiceDep,
):
    """Update job configuration (e.g., enable/disable, change schedule)."""
    try:
        job = await job_service.update_job_configuration(job_id, job_update)
        if not job:
            raise HTTPException(
                status_code=404,
                detail=f"Job configuration with ID {job_id} not found",
            )

        # Keep APScheduler in sync with DB changes immediately.
        from .scheduler import sync_job_configuration

        await sync_job_configuration(job.id)
        return job
    except HTTPException:
        raise
    except RiotWriterMaintenanceConfigurationError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as e:
        logger.error(
            "Failed to update job configuration",
            job_id=job_id,
            error=str(e),
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail="The job configuration could not be updated. Please try again later.",
        ) from e


# === Job Execution Endpoints ===


@router.get("/{job_id}/executions", response_model=JobExecutionListResponse)
async def get_job_executions(
    job_id: int,
    job_service: JobServiceDep,
    page: int = Query(1, ge=1, description="Page number"),
    size: int = Query(20, ge=1, le=100, description="Page size"),
    status: JobStatus | None = Query(None, description="Filter by status"),
    execution_type: ExecutionType | None = Query(
        None, description="Filter by execution type"
    ),
):
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
    try:
        executions = await job_service.list_job_executions(
            job_config_id=job_id,
            status=status,
            execution_type=execution_type,
            page=page,
            size=size,
        )
        return executions
    except Exception as e:
        logger.error(
            "Failed to list job executions",
            job_id=job_id,
            error=str(e),
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail="Job executions could not be loaded. Please try again later.",
        ) from e


@router.get("/executions/all", response_model=JobExecutionListResponse)
async def list_all_executions(
    job_service: JobServiceDep,
    page: int = Query(1, ge=1, description="Page number"),
    size: int = Query(20, ge=1, le=100, description="Page size"),
    status: JobStatus | None = Query(None, description="Filter by status"),
    execution_type: ExecutionType | None = Query(
        None, description="Filter by execution type"
    ),
):
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
    try:
        executions = await job_service.list_job_executions(
            status=status,
            execution_type=execution_type,
            page=page,
            size=size,
        )
        return executions
    except Exception as e:
        logger.error("Failed to list all executions", error=str(e), exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Job executions could not be loaded. Please try again later.",
        ) from e


# === Job Control Endpoints ===


@router.post("/{job_id}/trigger", response_model=JobTriggerResponse)
async def trigger_job(
    job_id: int,
    background_tasks: BackgroundTasks,
    job_service: JobServiceDep,
):
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
    try:
        # Check if job exists and is active
        job = await job_service.get_job_configuration(job_id)
        if not job:
            raise HTTPException(
                status_code=404,
                detail=f"Job configuration with ID {job_id} not found",
            )

        if not job.is_active:
            raise HTTPException(
                status_code=400,
                detail=f"Job '{job.name}' is not active and cannot be triggered",
            )

        # If a test run is active (non-suspended), stop it so the real run
        # can proceed.
        test_runtime_key = -job.id
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

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to trigger job",
            job_id=job_id,
            error=str(e),
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail="The job could not be triggered. Please try again later.",
        ) from e


@router.get("/{job_id}/control-state", response_model=JobControlActionResponse)
async def get_job_control_state(
    job_id: int,
    job_service: JobServiceDep,
):
    """Get pause/stop runtime state for a job."""
    try:
        state = await job_service.get_job_control_state(job_id)
        if not state:
            raise HTTPException(
                status_code=404,
                detail=f"Job configuration with ID {job_id} not found",
            )
        return state
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to get job control state",
            job_id=job_id,
            error=str(e),
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail="The job status could not be loaded. Please try again later.",
        ) from e


@router.post("/{job_id}/pause", response_model=JobControlActionResponse)
async def pause_job(
    job_id: int,
    job_service: JobServiceDep,
):
    """Pause a running job execution."""
    try:
        state = await job_service.set_job_paused(job_id, paused=True)
        if not state:
            raise HTTPException(
                status_code=404,
                detail=f"Job configuration with ID {job_id} not found",
            )
        if not state.success:
            raise HTTPException(status_code=409, detail=state.message)
        return state
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to pause job",
            job_id=job_id,
            error=str(e),
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail="The job could not be paused. Please try again later.",
        ) from e


@router.post("/{job_id}/resume", response_model=JobControlActionResponse)
async def resume_job(
    job_id: int,
    job_service: JobServiceDep,
):
    """Resume a paused running job execution."""
    try:
        state = await job_service.set_job_paused(job_id, paused=False)
        if not state:
            raise HTTPException(
                status_code=404,
                detail=f"Job configuration with ID {job_id} not found",
            )
        if not state.success:
            raise HTTPException(status_code=409, detail=state.message)
        return state
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to resume job",
            job_id=job_id,
            error=str(e),
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail="The job could not be resumed. Please try again later.",
        ) from e


@router.post("/{job_id}/stop", response_model=JobControlActionResponse)
async def stop_job(
    job_id: int,
    job_service: JobServiceDep,
    force: bool = Query(False, description="Force stop immediately"),
):
    """Request graceful or forced stop for a running job execution."""
    try:
        state = await job_service.request_job_stop_action(job_id, force=force)
        if not state:
            raise HTTPException(
                status_code=404,
                detail=f"Job configuration with ID {job_id} not found",
            )
        if not state.success:
            raise HTTPException(status_code=409, detail=state.message)
        return state
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to stop job",
            job_id=job_id,
            force=force,
            error=str(e),
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail="The job could not be stopped. Please try again later.",
        ) from e


# === Test Run Endpoints ===


@router.post("/{job_id}/test", response_model=JobTriggerResponse)
async def trigger_test_run(
    job_id: int,
    background_tasks: BackgroundTasks,
    job_service: JobServiceDep,
    suspend_regular: bool = Query(
        False,
        description="Whether to suspend regular scheduled runs during the test",
    ),
):
    """Start a test run for a job.

    The test run calls all Riot API endpoints the real job uses once per
    minute.  It never writes data to the database (except the execution
    record itself).  Runs for up to 1 hour or until stopped.

    Args:
        job_id: Job configuration ID.
        suspend_regular: If True, the scheduled job is paused for the duration.
    """
    try:
        job = await job_service.get_job_configuration(job_id)
        if not job:
            raise HTTPException(
                status_code=404,
                detail=f"Job configuration with ID {job_id} not found",
            )

        if not job.is_active:
            raise HTTPException(
                status_code=400,
                detail=f"Job '{job.name}' is not active and cannot be tested",
            )

        # Check if a test run is already active (negative key = test)
        test_runtime_key = -job.id
        if is_runtime_job_running(test_runtime_key):
            return JobTriggerResponse(
                success=False,
                message=f"A test run for '{job.name}' is already active.",
                execution_id=None,
            )

        # Suspend scheduled runs if requested
        if suspend_regular:
            from apscheduler.jobstores.base import JobLookupError

            from .scheduler import get_scheduler

            scheduler = get_scheduler()
            scheduler_job_id = f"job_{job.id}"
            if scheduler and scheduler.running:
                try:
                    scheduler.pause_job(scheduler_job_id)
                    logger.info(
                        "Suspended scheduled runs for test",
                        job_id=job_id,
                        scheduler_job_id=scheduler_job_id,
                    )
                except JobLookupError:
                    pass  # job not in scheduler — nothing to suspend

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

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to trigger test run",
            job_id=job_id,
            error=str(e),
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail="The test run could not be started. Please try again later.",
        ) from e


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
            from apscheduler.jobstores.base import JobLookupError

            from .scheduler import get_scheduler

            scheduler = get_scheduler()
            scheduler_job_id = f"job_{job_id}"
            if scheduler and scheduler.running:
                try:
                    scheduler.resume_job(scheduler_job_id)
                    logger.info(
                        "Resumed scheduled runs after test",
                        job_id=job_id,
                    )
                except JobLookupError:
                    pass


@router.post("/{job_id}/test/stop", response_model=JobControlActionResponse)
async def stop_test_run(
    job_id: int,
    job_service: JobServiceDep,
    force: bool = Query(False, description="Force stop immediately"),
):
    """Stop a running test for a job."""
    try:
        job = await job_service.get_job_configuration(job_id)
        if not job:
            raise HTTPException(
                status_code=404,
                detail=f"Job configuration with ID {job_id} not found",
            )

        test_runtime_key = -job.id
        was_applied = request_job_stop(test_runtime_key, force=force)
        test_state = get_runtime_control_snapshot(test_runtime_key)

        if not was_applied:
            return JobControlActionResponse(
                success=False,
                message="No test run is active for this job",
                is_running=False,
                is_paused=False,
                is_stopping=False,
                is_force_stopping=False,
            )

        return JobControlActionResponse(
            success=True,
            message=(
                f"Force stop requested for test run of '{job.name}'"
                if force
                else f"Stop requested for test run of '{job.name}'"
            ),
            is_running=test_state["is_running"],
            is_paused=False,
            is_stopping=test_state["stop_requested"],
            is_force_stopping=test_state["force_stop_requested"],
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to stop test run",
            job_id=job_id,
            error=str(e),
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail="The test run could not be stopped. Please try again later.",
        ) from e


@router.post("/{job_id}/test/pause", response_model=JobControlActionResponse)
async def pause_test_run(
    job_id: int,
    job_service: JobServiceDep,
):
    """Pause a running test execution."""
    try:
        job_model = await job_service.get_job_configuration_model(job_id)
        if not job_model:
            raise HTTPException(
                status_code=404,
                detail=f"Job configuration with ID {job_id} not found",
            )

        test_runtime_key = -job_model.id
        if not is_runtime_job_running(test_runtime_key):
            return JobControlActionResponse(
                success=False,
                message="No test run is active for this job",
                is_running=False,
                is_paused=False,
                is_stopping=False,
                is_force_stopping=False,
            )

        job_model.is_paused = True
        job_model.updated_at = datetime.now(UTC)
        await job_service.db.commit()
        await job_service.db.refresh(job_model)

        test_state = get_runtime_control_snapshot(test_runtime_key)
        return JobControlActionResponse(
            success=True,
            message=f"Test run for '{job_model.name}' paused",
            is_running=test_state["is_running"],
            is_paused=True,
            is_stopping=test_state["stop_requested"],
            is_force_stopping=test_state["force_stop_requested"],
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to pause test run",
            job_id=job_id,
            error=str(e),
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail="The test run could not be paused. Please try again later.",
        ) from e


@router.post("/{job_id}/test/resume", response_model=JobControlActionResponse)
async def resume_test_run(
    job_id: int,
    job_service: JobServiceDep,
):
    """Resume a paused test execution."""
    try:
        job_model = await job_service.get_job_configuration_model(job_id)
        if not job_model:
            raise HTTPException(
                status_code=404,
                detail=f"Job configuration with ID {job_id} not found",
            )

        test_runtime_key = -job_model.id
        if not is_runtime_job_running(test_runtime_key):
            return JobControlActionResponse(
                success=False,
                message="No test run is active for this job",
                is_running=False,
                is_paused=False,
                is_stopping=False,
                is_force_stopping=False,
            )

        job_model.is_paused = False
        job_model.updated_at = datetime.now(UTC)
        await job_service.db.commit()
        await job_service.db.refresh(job_model)

        test_state = get_runtime_control_snapshot(test_runtime_key)
        return JobControlActionResponse(
            success=True,
            message=f"Test run for '{job_model.name}' resumed",
            is_running=test_state["is_running"],
            is_paused=False,
            is_stopping=test_state["stop_requested"],
            is_force_stopping=test_state["force_stop_requested"],
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to resume test run",
            job_id=job_id,
            error=str(e),
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail="The test run could not be resumed. Please try again later.",
        ) from e


@router.get("/status/overview", response_model=JobStatusResponse)
async def get_job_system_status(
    job_service: JobServiceDep,
):
    """
    Get overall job system status.

    Returns:
        Job system status including scheduler state, active jobs,
        running executions, and last execution details.
    """
    try:
        from .scheduler import get_scheduler

        # Get metrics
        active_jobs = await job_service.get_active_job_count()
        running_executions = await job_service.get_running_execution_count()
        last_execution = await job_service.get_latest_execution()

        # Get actual scheduler status
        scheduler = get_scheduler()
        scheduler_running = scheduler is not None and scheduler.running

        return JobStatusResponse(
            scheduler_running=scheduler_running,
            active_jobs=active_jobs,
            running_executions=running_executions,
            last_execution=last_execution,
            next_run_time=None,  # TODO: Get from scheduler
        )

    except Exception as e:
        logger.error("Failed to get job system status", error=str(e), exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="The job system status could not be loaded. Please try again later.",
        ) from e


@router.post("/sync-player/{puuid}", response_model=JobTriggerResponse)
async def sync_player_data(
    puuid: str,
    background_tasks: BackgroundTasks,
    job_service: JobServiceDep,
):
    """
    Trigger a full sync for a specific player (matches + profile).

    This runs the Match Fetcher job followed by the Player Updater job
    for the specified player. Used by Update buttons on player cards.

    Includes job locking to prevent concurrent runs - if either job
    is already running, returns a message instead of running again.

    Args:
        puuid: Player's PUUID to sync.
        background_tasks: FastAPI background tasks for async execution.

    Returns:
        Job trigger response indicating success or if job is already running.
    """
    try:
        # Check if either job is already running
        match_fetcher_running = await job_service.is_job_running(JobType.MATCH_FETCHER)
        player_updater_running = await job_service.is_job_running(
            JobType.PLAYER_UPDATER
        )

        if match_fetcher_running or player_updater_running:
            running_jobs: list[str] = []
            if match_fetcher_running:
                running_jobs.append("Match Fetcher")
            if player_updater_running:
                running_jobs.append("Player Updater")

            logger.info(
                "Sync requested but job already running",
                puuid=puuid,
                running_jobs=running_jobs,
            )
            return JobTriggerResponse(
                success=False,
                message=f"Update already in progress ({', '.join(running_jobs)} running). Please wait.",
                execution_id=None,
            )

        # Get job configurations
        match_fetcher_config = await job_service.get_job_config_by_type(
            JobType.MATCH_FETCHER
        )
        player_updater_config = await job_service.get_job_config_by_type(
            JobType.PLAYER_UPDATER
        )

        if not match_fetcher_config:
            raise HTTPException(
                status_code=500,
                detail="Match Fetcher job configuration not found",
            )

        # Trigger Match Fetcher job
        match_fetcher_job = MatchFetcherJob(
            match_fetcher_config.id, triggered_by="user"
        )
        background_tasks.add_task(match_fetcher_job.run)

        # Trigger Player Updater job (if config exists)
        if player_updater_config:
            player_updater_job = PlayerUpdaterJob(
                player_updater_config.id, triggered_by="user"
            )
            background_tasks.add_task(player_updater_job.run)

        logger.info(
            "Player sync triggered",
            puuid=puuid,
            match_fetcher_id=match_fetcher_config.id,
            player_updater_id=(
                player_updater_config.id if player_updater_config else None
            ),
        )

        return JobTriggerResponse(
            success=True,
            message="Player sync started. Match history and profile will be updated.",
            execution_id=None,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to sync player data",
            puuid=puuid,
            error=str(e),
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail="Player data sync could not be started. Please try again later.",
        ) from e


@router.get("/running-status", response_model=dict)
async def get_running_jobs_status(
    job_service: JobServiceDep,
):
    """
    Check which jobs are currently running.

    Returns:
        Dict with job types and their running status.
    """
    try:
        match_fetcher_running = await job_service.is_job_running(JobType.MATCH_FETCHER)
        player_updater_running = await job_service.is_job_running(
            JobType.PLAYER_UPDATER
        )

        return {
            "match_fetcher_running": match_fetcher_running,
            "player_updater_running": player_updater_running,
            "any_running": match_fetcher_running or player_updater_running,
        }

    except Exception as e:
        logger.error("Failed to get running jobs status", error=str(e), exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="The job status could not be checked. Please try again later.",
        ) from e
