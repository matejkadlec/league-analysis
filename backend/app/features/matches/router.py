"""Match API endpoints for the Riot API application."""

from fastapi import APIRouter, HTTPException, Query, BackgroundTasks, Depends
from typing import Optional, Dict, Any
import uuid
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db

from .schemas import (
    MatchListResponse,
    MatchListWithPlayerDataResponse,
    MatchStatsResponse,
    ChampionStatsResponse,
    LaneStatsResponse,
)
from .dependencies import (
    MatchServiceDep,
    get_match_service,
)

router = APIRouter(prefix="/matches", tags=["matches"])
router.get_match_service = get_match_service  # type: ignore[attr-defined]

# In-memory job store for analysis tasks
analysis_jobs: Dict[str, Dict[str, Any]] = {}


@router.get("/player/{puuid}", response_model=MatchListResponse)
async def get_player_matches(
    puuid: str,
    match_service: MatchServiceDep,
    queue: Optional[int] = Query(None, description="Queue ID filter"),
    start: int = Query(0, ge=0, description="Start index"),
    count: int = Query(20, ge=1, le=100, description="Number of matches to return"),
):
    """
    Get match history for a player from local database.
    """
    return await match_service.get_player_matches(
        puuid=puuid,
        start=start,
        count=count,
        queue=queue,
    )


@router.get("/player/{puuid}/detailed", response_model=MatchListWithPlayerDataResponse)
async def get_player_matches_detailed(
    puuid: str,
    match_service: MatchServiceDep,
    queue: Optional[int] = Query(None, description="Queue ID filter"),
    start: int = Query(0, ge=0, description="Start index"),
    count: int = Query(20, ge=1, le=100, description="Number of matches to return"),
):
    """
    Get detailed match history for a player including champion data,
    lane opponent, and LP changes.
    """
    return await match_service.get_player_matches_with_data(
        puuid=puuid,
        start=start,
        count=count,
        queue=queue,
    )


@router.get("/player/{puuid}/stats", response_model=MatchStatsResponse)
async def get_player_stats(
    puuid: str,
    match_service: MatchServiceDep,
    queue: Optional[int] = Query(None, description="Queue ID filter"),
    limit: Optional[int] = Query(
        None,
        ge=1,
        description="Number of matches to analyze. If not provided, uses all matches.",
    ),
):
    """
    Get aggregated statistics for a player from recent matches.
    If limit is not provided, all matches in the database will be analyzed.
    """
    return await match_service.get_player_stats(
        puuid=puuid,
        queue=queue,
        limit=limit,
    )


@router.get("/player/{puuid}/champion-stats", response_model=ChampionStatsResponse)
async def get_player_champion_stats(
    puuid: str,
    match_service: MatchServiceDep,
    queue: Optional[int] = Query(
        None, description="Queue ID filter (e.g., 420 for ranked solo/duo)"
    ),
    limit: int = Query(
        20, ge=1, le=50, description="Maximum number of champions to return"
    ),
):
    """
    Get player statistics grouped by champion.
    Returns champions sorted by games played descending.
    """
    return await match_service.get_player_champion_stats(
        puuid=puuid,
        queue=queue,
        limit=limit,
    )


@router.get("/player/{puuid}/lane-stats", response_model=LaneStatsResponse)
async def get_player_lane_stats(
    puuid: str,
    match_service: MatchServiceDep,
    queue: Optional[int] = Query(
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
    api_key: str,
):
    """Background task for analysis.

    Scenarios:
    1. Fetch last 100 matches from Riot API (Queue 420)
    2. Upsert them to DB
    3. Update job status
    """
    # Force immediate status update to indicate task has started
    if job_id in analysis_jobs:
        analysis_jobs[job_id]["status"] = "in_progress"
        analysis_jobs[job_id]["message"] = "Task started..."

    import sys

    # Print to stderr to ensure visibility even if logging is misconfigured
    print(f"DEBUG: Starting analysis task for job {job_id}", file=sys.stderr)

    import logging
    import traceback

    logger = logging.getLogger(__name__)

    try:
        from app.core.riot_api.client import RiotAPIClient
        from app.features.matches.service import MatchService
        from app.core.database import db_manager

        analysis_jobs[job_id]["message"] = "Preparing analysis..."

        # Callback for progress updates
        async def progress_callback(current, total):
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
                analysis_jobs[job_id][
                    "message"
                ] = f"Analysis in progress... Processing {current} of {total} requests"

        # Cancellation check callback
        def should_cancel() -> bool:
            return analysis_jobs.get(job_id, {}).get("cancelled", False)

        # Create a new session for the background task
        async with db_manager.get_session() as session:
            match_service = MatchService(session)

            async with RiotAPIClient(api_key) as client:
                # 1. Fetch and update match data
                analysis_jobs[job_id][
                    "message"
                ] = "Fetching match list from Riot API..."
                print(
                    f"DEBUG: Client initialized, fetching matches for {puuid}",
                    file=sys.stderr,
                )

                # We specifically request count=100 and queue=420 (Ranked Solo)
                count = await match_service.analyze_match_history(
                    client,
                    puuid,
                    progress_callback=progress_callback,
                    should_cancel=should_cancel,
                )

                # Check if we finished due to cancellation
                if should_cancel():
                    analysis_jobs[job_id]["status"] = "cancelled"
                    analysis_jobs[job_id][
                        "message"
                    ] = f"Analysis cancelled. Processed {count} matches."
                    print(
                        f"DEBUG: Analysis cancelled. Processed {count} matches.",
                        file=sys.stderr,
                    )
                    return

                print(
                    f"DEBUG: Analysis finished. Processed {count} matches.",
                    file=sys.stderr,
                )

                analysis_jobs[job_id]["status"] = "completed"
                analysis_jobs[job_id]["matches_processed"] = count
                analysis_jobs[job_id]["message"] = "Match history updated successfully"

    except Exception as e:
        error_msg = str(e)
        stack_trace = traceback.format_exc()

        logger.error(f"Analysis failed for job {job_id}: {error_msg}")
        logger.error(stack_trace)
        print(
            f"ERROR: Analysis job {job_id} failed: {error_msg}\n{stack_trace}",
            file=sys.stderr,
        )

        # Check for Rate Limit specific error string
        if "429" in error_msg:
            error_msg = "Riot API Rate Limit Exceeded. Please try again in 2 minutes."

        # Ensure we don't crash the dict access if job was removed (unlikely but safe)
        if job_id in analysis_jobs:
            analysis_jobs[job_id]["status"] = "failed"
            analysis_jobs[job_id]["error"] = error_msg


@router.post("/analyze/{puuid}")
async def analyze_match_history(
    puuid: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Start match history analysis background job."""
    import os
    from app.core.config import get_riot_api_key

    try:
        api_key = await get_riot_api_key(db)
    except ValueError:
        api_key = os.getenv("RIOT_API_KEY")

    if not api_key:
        raise HTTPException(
            status_code=500, detail="RIOT_API_KEY not configured (DB or ENV)"
        )

    job_id = str(uuid.uuid4())
    analysis_jobs[job_id] = {
        "status": "pending",
        "progress": 0,
        "total": 0,
        "message": "Initializing...",
        "estimated_minutes_remaining": 5,  # Rough estimate
    }

    background_tasks.add_task(_run_analysis_task, job_id, puuid, api_key)

    return {"job_id": job_id, "status": "pending"}


@router.post("/analyze/cancel/{job_id}")
async def cancel_analysis_job(job_id: str):
    """Cancel a running analysis job."""
    if job_id not in analysis_jobs:
        raise HTTPException(status_code=404, detail="Job not found")

    analysis_jobs[job_id]["cancelled"] = True
    analysis_jobs[job_id]["status"] = "cancelling"
    analysis_jobs[job_id]["message"] = "Analysis cancelled"

    return {"job_id": job_id, "status": "cancelling"}


@router.get("/analyze/status/{job_id}")
async def get_analysis_status(job_id: str):
    """Get status of match history analysis job."""
    if job_id not in analysis_jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    return analysis_jobs[job_id]
