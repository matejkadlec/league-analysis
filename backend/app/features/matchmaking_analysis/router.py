"""Matchmaking analysis API endpoints."""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.core.http_rate_limit import rate_limit
from app.core.schemas import MessageResponse
from app.features.auth.dependencies import get_current_active_user
from app.features.jobs.maintenance import RiotWriterMaintenanceActiveError

from .dependencies import MatchmakingServiceDep
from .schemas import (
    MatchmakingAnalysisHistoryResponse,
    MatchmakingAnalysisParams,
    MatchmakingAnalysisRequest,
    MatchmakingAnalysisResponse,
)

router = APIRouter(
    prefix="/matchmaking-analysis",
    tags=["matchmaking-analysis"],
    dependencies=[Depends(get_current_active_user)],
)


@router.post("/start")
@rate_limit("10/minute")
async def start_analysis(
    request: Request,
    payload: MatchmakingAnalysisRequest,
    service: MatchmakingServiceDep,
) -> MatchmakingAnalysisResponse:
    """
    Start a new matchmaking analysis for a player.

    The endpoint only creates or attaches to the persisted run. All Riot calls
    happen in the background, so it is never tied to the HTTP request timeout.
    """
    try:
        return await service.start_analysis(
            payload.puuid,
            MatchmakingAnalysisParams(
                match_count=payload.match_count,
                end_date=payload.end_date,
            ),
        )
    except RiotWriterMaintenanceActiveError as error:
        raise HTTPException(
            status_code=503,
            detail="Riot data maintenance is in progress. Try again after it completes.",
        ) from error


@router.get("/player/{puuid}")
async def get_latest_analysis(
    puuid: str,
    service: MatchmakingServiceDep,
) -> MatchmakingAnalysisResponse:
    """Get the latest analysis for a player."""
    result = await service.get_latest_analysis(puuid)

    if not result:
        raise HTTPException(status_code=404, detail="No analysis found for this player")

    return result


@router.get(
    "/player/{puuid}/latest-completed",
)
async def get_latest_completed_analysis(
    puuid: str,
    service: MatchmakingServiceDep,
) -> MatchmakingAnalysisResponse:
    """Get the latest completed analysis for a player."""
    result = await service.get_latest_completed_analysis(puuid)
    if not result:
        raise HTTPException(
            status_code=404, detail="No completed analysis found for this player"
        )
    return result


@router.get("/player/{puuid}/status")
async def get_analysis_status_by_puuid(
    puuid: str,
    created_at: datetime,
    service: MatchmakingServiceDep,
) -> MatchmakingAnalysisResponse:
    """Get authoritative status for one exact analysis run, re-arming it.

    Not a pure read: a deploy leaves an interrupted run active with no
    worker, and this poll is what starts one for it again.
    """
    result = await service.get_analysis_status(puuid, created_at)

    if not result:
        raise HTTPException(status_code=404, detail="No analysis found for this player")

    return result


@router.get(
    "/player/{puuid}/history",
)
async def get_analysis_history(
    puuid: str,
    service: MatchmakingServiceDep,
    limit: Annotated[
        int, Query(ge=1, le=100, description="Number of completed analyses to return")
    ] = 20,
) -> MatchmakingAnalysisHistoryResponse:
    """Get history of completed analyses for a player.

    The bound is not decoration: `?limit=-1` renders as `LIMIT -1`, which
    PostgreSQL rejects. 100 is the ceiling because the only production caller,
    `matchmaking-analysis-history.tsx`, asks for exactly that many.
    """
    return await service.get_analysis_history(puuid, limit=limit)


@router.delete("/player/{puuid}/cancel")
async def cancel_analysis(
    puuid: str,
    created_at: datetime,
    service: MatchmakingServiceDep,
) -> MessageResponse:
    """Cancel a running matchmaking analysis.

    Cancels the exact background run and preserves its terminal state. Already-
    fetched matches are kept in the database.
    """
    cancelled = await service.cancel_analysis(puuid, created_at)
    if not cancelled:
        raise HTTPException(
            status_code=404, detail="No active analysis found for this player"
        )
    return MessageResponse(message="Analysis cancelled")


@router.delete("/player/{puuid}/analysis")
async def delete_analysis_record(
    puuid: str,
    created_at: datetime,
    service: MatchmakingServiceDep,
) -> MessageResponse:
    """Delete a specific completed analysis record."""
    deleted = await service.delete_analysis(puuid, created_at)
    if not deleted:
        raise HTTPException(status_code=404, detail="Analysis record not found")
    return MessageResponse(message="Analysis record deleted")
