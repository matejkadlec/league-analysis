"""Match API endpoints for the Riot API application."""

import uuid
from collections.abc import Callable
from typing import Any, ParamSpec, Protocol, TypeVar, cast

import structlog
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    HTTPException,
    Query,
    Request,
)
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.riot_api.db_rate_limiter import DBRateLimiter, RateLimitComponent
from app.features.auth.dependencies import get_current_active_user
from app.features.auth.models import User

from .dependencies import (
    MatchServiceDep,
    get_match_service,
)
from .schemas import (
    ChampionStatsResponse,
    LaneStatsResponse,
    MatchListResponse,
    MatchListWithPlayerDataResponse,
    MatchStatsResponse,
)

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/matches", tags=["matches"])
router.get_match_service = get_match_service  # type: ignore[attr-defined]
limiter = Limiter(key_func=get_remote_address)

_P = ParamSpec("_P")
_R = TypeVar("_R")


class _SignaturePreservingLimiter(Protocol):
    """The slice of `Limiter` this module uses, with its signature spelled out.

    `slowapi` ships `Limiter.limit` with an unannotated inner decorator, which
    erases the type of every endpoint it wraps. Viewing the same object through
    this protocol keeps the decorated endpoints typed without changing what runs.
    """

    def limit(
        self, limit_value: str
    ) -> Callable[[Callable[_P, _R]], Callable[_P, _R]]: ...


typed_limiter = cast(_SignaturePreservingLimiter, limiter)

# In-memory job store for analysis tasks
analysis_jobs: dict[str, dict[str, Any]] = {}


def _parse_match_queue_union(queues: str) -> tuple[int, ...]:
    """Validate one comma-separated queue union."""
    raw_queue_ids = [value.strip() for value in queues.split(",")]
    if not raw_queue_ids or any(not value for value in raw_queue_ids):
        raise HTTPException(status_code=422, detail="Invalid queue selection.")

    try:
        queue_ids = tuple(dict.fromkeys(int(value) for value in raw_queue_ids))
    except ValueError as error:
        raise HTTPException(
            status_code=422, detail="Queue IDs must be positive integers."
        ) from error

    if len(queue_ids) > 10 or any(queue_id <= 0 for queue_id in queue_ids):
        raise HTTPException(
            status_code=422,
            detail="Provide between one and ten positive queue IDs.",
        )
    return queue_ids


def parse_match_queue_ids(
    queue: int | None, queues: str | None
) -> tuple[int, ...] | None:
    """Parse the legacy scalar or comma-separated queue union, never both."""
    if queue is not None and queues is not None:
        raise HTTPException(
            status_code=422,
            detail="Use either queue or queues, not both.",
        )
    if queues is not None:
        return _parse_match_queue_union(queues)
    return (queue,) if queue is not None else None


@router.get("/player/{puuid}", response_model=MatchListResponse)
async def get_player_matches(
    puuid: str,
    match_service: MatchServiceDep,
    queue: int | None = Query(None, description="Queue ID filter"),
    queues: str | None = Query(
        None, max_length=200, description="Comma-separated queue ID filters"
    ),
    exclude_aram: bool = Query(False, description="Exclude queue 450 (ARAM)"),
    start: int = Query(0, ge=0, description="Start index"),
    count: int = Query(20, ge=1, le=1000, description="Number of matches to return"),
):
    """
    Get match history for a player from local database.
    """
    queue_ids = parse_match_queue_ids(queue, queues)
    return await match_service.get_player_matches(
        puuid=puuid,
        start=start,
        count=count,
        queue_ids=queue_ids,
        exclude_aram=exclude_aram,
    )


@router.get("/player/{puuid}/detailed", response_model=MatchListWithPlayerDataResponse)
async def get_player_matches_detailed(
    puuid: str,
    match_service: MatchServiceDep,
    queue: int | None = Query(None, description="Queue ID filter"),
    queues: str | None = Query(
        None, max_length=200, description="Comma-separated queue ID filters"
    ),
    search: str | None = Query(
        None,
        max_length=64,
        description="Champion or participant Riot ID search",
    ),
    exclude_aram: bool = Query(False, description="Exclude queue 450 (ARAM)"),
    start: int = Query(0, ge=0, description="Start index"),
    count: int = Query(20, ge=1, le=1000, description="Number of matches to return"),
):
    """
    Get detailed match history for a player including champion data,
    lane opponent, and LP changes.
    """
    queue_ids = parse_match_queue_ids(queue, queues)
    return await match_service.get_player_matches_with_data(
        puuid=puuid,
        start=start,
        count=count,
        queue_ids=queue_ids,
        search=search.strip() or None if search is not None else None,
        exclude_aram=exclude_aram,
    )


@router.get("/player/{puuid}/stats", response_model=MatchStatsResponse)
async def get_player_stats(
    puuid: str,
    match_service: MatchServiceDep,
    queue: int | None = Query(None, description="Queue ID filter"),
    queues: str | None = Query(
        None, max_length=200, description="Comma-separated queue ID filters"
    ),
    exclude_aram: bool = Query(False, description="Exclude queue 450 (ARAM)"),
    limit: int | None = Query(
        None,
        ge=1,
        description="Number of matches to analyze. If not provided, uses all matches.",
    ),
):
    """
    Get aggregated statistics for a player from recent matches.
    If limit is not provided, all matches in the database will be analyzed.
    """
    queue_ids = parse_match_queue_ids(queue, queues)
    return await match_service.get_player_stats(
        puuid=puuid,
        queue_ids=queue_ids,
        limit=limit,
        exclude_aram=exclude_aram,
    )


@router.get("/player/{puuid}/champion-stats", response_model=ChampionStatsResponse)
async def get_player_champion_stats(
    puuid: str,
    match_service: MatchServiceDep,
    queue: int | None = Query(
        None, description="Queue ID filter (e.g., 420 for ranked solo/duo)"
    ),
):
    """
    Get player statistics grouped by champion.
    Returns every qualifying champion sorted by games played descending.
    """
    return await match_service.get_player_champion_stats(
        puuid=puuid,
        queue=queue,
    )


@router.get("/player/{puuid}/lane-stats", response_model=LaneStatsResponse)
async def get_player_lane_stats(
    puuid: str,
    match_service: MatchServiceDep,
    queue: int | None = Query(
        None, description="Queue ID filter (e.g., 420 for ranked solo/duo)"
    ),
):
    """
    Get player statistics grouped by lane/position.
    Returns lanes sorted by games played descending.
    """
    return await match_service.get_player_lane_stats(
        puuid=puuid,
        queue=queue,
    )


# ... (Previous code)


async def _run_analysis_task(
    job_id: str,
    puuid: str,
):
    """Background task for analysis.

    Scenarios:
    1. Fetch the last 100 matches for every product-supported queue
    2. Upsert them to DB
    3. Update job status
    """
    # Force immediate status update to indicate task has started
    if job_id in analysis_jobs:
        analysis_jobs[job_id]["status"] = "in_progress"
        analysis_jobs[job_id]["message"] = "Task started..."

    logger.debug("analysis_task_started", job_id=job_id, puuid=puuid)

    rate_limiter: DBRateLimiter | None = None

    try:
        from app.core.database import db_manager
        from app.core.riot_api.credential_health import create_tracked_riot_api_client
        from app.features.matches.service import MatchService

        analysis_jobs[job_id]["message"] = "Preparing analysis..."

        # Callback for progress updates
        async def progress_callback(current: int, total: int) -> None:
            if job_id in analysis_jobs:
                # Check for cancellation during progress update
                if analysis_jobs[job_id].get("cancelled", False):
                    # We will handle the break in the service via should_cancel
                    pass

                analysis_jobs[job_id]["progress"] = current
                analysis_jobs[job_id]["total"] = total

                # Calculate estimate (1.5s per request)
                remaining = total - current
                est_seconds = remaining * 1.5
                est_minutes = int(est_seconds / 60)
                if est_seconds > 0 and est_minutes == 0:
                    est_minutes = 1

                analysis_jobs[job_id]["estimated_minutes_remaining"] = est_minutes
                analysis_jobs[job_id]["message"] = (
                    f"Analysis in progress... Processing {current} of {total} requests"
                )

        # Cancellation check callback
        def should_cancel() -> bool:
            return analysis_jobs.get(job_id, {}).get("cancelled", False)

        # Create a new session for the background task
        async with db_manager.get_session() as session:
            match_service = MatchService(session)

            async with await create_tracked_riot_api_client(session) as client:
                rate_limiter = DBRateLimiter(
                    session, RateLimitComponent.MATCHMAKING_ANALYSIS
                )
                # 1. Fetch and update match data
                analysis_jobs[job_id]["message"] = (
                    "Fetching match list from Riot API..."
                )
                logger.debug(
                    "analysis_task_fetching_matches", job_id=job_id, puuid=puuid
                )

                # Analyze the complete canonical product-supported queue set.
                count = await match_service.analyze_match_history(
                    client,
                    puuid,
                    progress_callback=progress_callback,
                    should_cancel=should_cancel,
                    rate_limiter=rate_limiter,
                )

                # Check if we finished due to cancellation
                if should_cancel():
                    analysis_jobs[job_id]["status"] = "cancelled"
                    analysis_jobs[job_id]["message"] = (
                        f"Analysis cancelled. Processed {count} matches."
                    )
                    logger.info(
                        "analysis_task_cancelled",
                        job_id=job_id,
                        puuid=puuid,
                        matches_processed=count,
                    )
                    return

                logger.info(
                    "analysis_task_completed",
                    job_id=job_id,
                    puuid=puuid,
                    matches_processed=count,
                )

                analysis_jobs[job_id]["status"] = "completed"
                analysis_jobs[job_id]["matches_processed"] = count
                analysis_jobs[job_id]["message"] = "Match history updated successfully"

    except Exception as e:
        error_msg = str(e)

        logger.error(
            "analysis_task_failed",
            job_id=job_id,
            puuid=puuid,
            error=error_msg,
            error_type=type(e).__name__,
            exc_info=True,
        )

        # Check for Rate Limit specific error string
        if "429" in error_msg:
            error_msg = "Riot API Rate Limit Exceeded. Please try again in 2 minutes."

        # Ensure we don't crash the dict access if job was removed (unlikely but safe)
        if job_id in analysis_jobs:
            analysis_jobs[job_id]["status"] = "failed"
            analysis_jobs[job_id]["error"] = error_msg
    finally:
        if rate_limiter is not None:
            try:
                await rate_limiter.release()
            except Exception as release_error:
                logger.warning(
                    "analysis_task_rate_limiter_release_failed",
                    job_id=job_id,
                    error_type=type(release_error).__name__,
                    error=str(release_error),
                )


@router.post("/analyze/{puuid}")
@typed_limiter.limit("5/minute")
async def analyze_match_history(
    request: Request,
    puuid: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Start match history analysis background job."""
    from app.core.riot_api.credential_health import (
        synchronize_riot_credential_health,
    )
    from app.features.jobs.maintenance import (
        RiotWriterMaintenanceActiveError,
        ensure_riot_writer_maintenance_is_inactive,
    )

    try:
        await ensure_riot_writer_maintenance_is_inactive(db)
    except RiotWriterMaintenanceActiveError as error:
        raise HTTPException(
            status_code=503,
            detail="Riot data maintenance is in progress. Try again after it completes.",
        ) from error

    try:
        credential, _health = await synchronize_riot_credential_health(db)
    except ValueError:
        credential = None

    if credential is None:
        raise HTTPException(
            status_code=503,
            detail="Riot data is unavailable because no Riot API key is configured. An administrator can add one on the Settings page.",
        )

    job_id = str(uuid.uuid4())
    analysis_jobs[job_id] = {
        "user_id": current_user.id,
        "status": "pending",
        "progress": 0,
        "total": 0,
        "message": "Initializing...",
        "estimated_minutes_remaining": 5,  # Rough estimate
    }

    background_tasks.add_task(_run_analysis_task, job_id, puuid)

    return {"job_id": job_id, "status": "pending"}


@router.post("/analyze/cancel/{job_id}")
async def cancel_analysis_job(
    job_id: str,
    current_user: User = Depends(get_current_active_user),
):
    """Cancel a running analysis job."""
    if job_id not in analysis_jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    if analysis_jobs[job_id].get("user_id") != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized for this job")

    analysis_jobs[job_id]["cancelled"] = True
    analysis_jobs[job_id]["status"] = "cancelling"
    analysis_jobs[job_id]["message"] = "Analysis cancelled"

    return {"job_id": job_id, "status": "cancelling"}


@router.get("/analyze/status/{job_id}")
async def get_analysis_status(
    job_id: str,
    current_user: User = Depends(get_current_active_user),
):
    """Get status of match history analysis job."""
    if job_id not in analysis_jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    if analysis_jobs[job_id].get("user_id") != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized for this job")
    return analysis_jobs[job_id]
