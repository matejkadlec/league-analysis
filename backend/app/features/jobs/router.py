"""Job management API endpoints."""

from typing import Optional
from fastapi import APIRouter, HTTPException, Query, BackgroundTasks, Depends

from .models import JobStatus, JobType
from .schemas import (
    JobConfigurationUpdate,
    JobConfigurationResponse,
    JobExecutionListResponse,
    JobStatusResponse,
    JobTriggerResponse,
)
from .dependencies import JobServiceDep
from app.features.auth.dependencies import get_current_admin_user

from .implementations.match_fetcher import MatchFetcherJob
from .implementations.player_updater import PlayerUpdaterJob
import structlog

logger = structlog.get_logger(__name__)

router = APIRouter(
    prefix="/jobs",
    tags=["jobs"],
    dependencies=[Depends(get_current_admin_user)],
)


def _create_job_instance(job, triggered_by: str = "system"):
    """Create a job instance based on job type.

    Args:
        job: Job configuration (JobConfiguration or JobConfigurationResponse)
        triggered_by: Who triggered the job: 'system' (scheduler) or 'user' (manual).

    Returns:
        Job instance based on job type
    """
    job_type_mapping = {
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
            detail="Internal server error retrieving job configurations",
        )


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
    except Exception as e:
        logger.error(
            "Failed to update job configuration",
            job_id=job_id,
            error=str(e),
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail="Internal server error updating job configuration",
        )


# === Job Execution Endpoints ===


@router.get("/{job_id}/executions", response_model=JobExecutionListResponse)
async def get_job_executions(
    job_id: int,
    job_service: JobServiceDep,
    page: int = Query(1, ge=1, description="Page number"),
    size: int = Query(20, ge=1, le=100, description="Page size"),
    status: Optional[JobStatus] = Query(None, description="Filter by status"),
):
    """
    Get execution history for a specific job.

    Args:
        job_id: Job configuration ID.
        page: Page number (1-indexed).
        size: Number of executions per page.
        status: Optional status filter.

    Returns:
        Paginated list of job executions.
    """
    try:
        executions = await job_service.list_job_executions(
            job_config_id=job_id,
            status=status,
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
            detail="Internal server error retrieving job executions",
        )


@router.get("/executions/all", response_model=JobExecutionListResponse)
async def list_all_executions(
    job_service: JobServiceDep,
    page: int = Query(1, ge=1, description="Page number"),
    size: int = Query(20, ge=1, le=100, description="Page size"),
    status: Optional[JobStatus] = Query(None, description="Filter by status"),
):
    """
    Get execution history for all jobs.

    Args:
        page: Page number (1-indexed).
        size: Number of executions per page.
        status: Optional status filter.

    Returns:
        Paginated list of all job executions.
    """
    try:
        executions = await job_service.list_job_executions(
            status=status,
            page=page,
            size=size,
        )
        return executions
    except Exception as e:
        logger.error("Failed to list all executions", error=str(e), exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Internal server error retrieving all job executions",
        )


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
            detail="Internal server error triggering job",
        )


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
            detail="Internal server error retrieving job system status",
        )


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
            running_jobs = []
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
            detail="Internal server error syncing player data",
        )


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
            detail="Internal server error checking job status",
        )
