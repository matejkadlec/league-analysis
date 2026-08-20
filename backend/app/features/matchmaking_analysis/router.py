"""Matchmaking analysis API endpoints."""

from datetime import datetime

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request

from app.core.http_errors import log_and_raise_http
from app.core.rate_limiter import rate_limit
from app.features.auth.dependencies import get_current_active_user
from app.features.jobs.maintenance import RiotWriterMaintenanceActiveError

from .dependencies import MatchmakingServiceDep
from .schemas import (
    MatchmakingAnalysisHistoryResponse,
    MatchmakingAnalysisRequest,
    MatchmakingAnalysisResponse,
    MatchmakingAnalysisStatusResponse,
)

logger = structlog.get_logger(__name__)


router = APIRouter(
    prefix="/matchmaking-analysis",
    tags=["matchmaking-analysis"],
    dependencies=[Depends(get_current_active_user)],
)


@router.post("/start", response_model=MatchmakingAnalysisResponse)
@rate_limit("10/minute")
async def start_analysis(
    request: Request,
    payload: MatchmakingAnalysisRequest,
    service: MatchmakingServiceDep,
):
    """
    Start a new matchmaking analysis for a player.

    The endpoint only creates or attaches to the persisted run. All Riot calls,
    including the minimum-match preflight, happen in the background so a valid
    long-running analysis is never tied to the HTTP request timeout.
    """
    try:
        return await service.start_analysis(payload.puuid)
    except HTTPException:
        raise
    except RiotWriterMaintenanceActiveError as error:
        raise HTTPException(
            status_code=503,
            detail="Riot data maintenance is in progress. Try again after it completes.",
        ) from error
    except Exception as error:
        log_and_raise_http(
            logger,
            error,
            "matchmaking_analysis_start_failed",
            error_type=type(error).__name__,
        )


@router.get("/player/{puuid}", response_model=MatchmakingAnalysisResponse)
async def get_latest_analysis(
    puuid: str,
    service: MatchmakingServiceDep,
):
    """Get the latest analysis for a player."""
    result = await service.get_latest_analysis(puuid)

    if not result:
        raise HTTPException(status_code=404, detail="No analysis found for this player")

    return result


@router.get(
    "/player/{puuid}/latest-completed", response_model=MatchmakingAnalysisResponse
)
async def get_latest_completed_analysis(
    puuid: str,
    service: MatchmakingServiceDep,
):
    """Get the latest completed analysis for a player."""
    result = await service.get_latest_completed_analysis(puuid)
    if not result:
        raise HTTPException(
            status_code=404, detail="No completed analysis found for this player"
        )
    return result


@router.get("/player/{puuid}/status", response_model=MatchmakingAnalysisStatusResponse)
async def get_analysis_status_by_puuid(
    puuid: str,
    created_at: datetime,
    service: MatchmakingServiceDep,
):
    """Get authoritative status for one exact analysis run."""
    result = await service.get_analysis_status(puuid, created_at)

    if not result:
        raise HTTPException(status_code=404, detail="No analysis found for this player")

    return result


@router.get(
    "/player/{puuid}/history", response_model=MatchmakingAnalysisHistoryResponse
)
async def get_analysis_history(
    puuid: str,
    service: MatchmakingServiceDep,
    limit: int = 20,
):
    """Get history of completed analyses for a player."""
    return await service.get_analysis_history(puuid, limit=limit)


@router.delete("/player/{puuid}/cancel")
async def cancel_analysis(
    puuid: str,
    created_at: datetime,
    service: MatchmakingServiceDep,
):
    """Cancel a running matchmaking analysis.

    Cancels the exact background run and preserves its terminal state. Already-
    fetched matches are kept in the database.
    """
    cancelled = await service.cancel_analysis(puuid, created_at)
    if not cancelled:
        raise HTTPException(
            status_code=404, detail="No active analysis found for this player"
        )
    return {"success": True, "message": "Analysis cancelled"}


@router.delete("/player/{puuid}/analysis")
async def delete_analysis_record(
    puuid: str,
    created_at: datetime,
    service: MatchmakingServiceDep,
):
    """Delete a specific completed analysis record."""
    deleted = await service.delete_analysis(puuid, created_at)
    if not deleted:
        raise HTTPException(status_code=404, detail="Analysis record not found")
    return {"success": True, "message": "Analysis record deleted"}
