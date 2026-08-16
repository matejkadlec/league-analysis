"""Matchmaking analysis API endpoints."""

from collections.abc import Callable
from datetime import datetime
from typing import ParamSpec, Protocol, TypeVar

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core.riot_api.errors import (
    RIOT_API_KEY_INVALID_DETAIL,
    AuthenticationError,
    ForbiddenError,
)
from app.features.auth.dependencies import get_current_active_user
from app.features.jobs.maintenance import RiotWriterMaintenanceActiveError

from .dependencies import MatchmakingServiceDep
from .schemas import (
    MatchmakingAnalysisHistoryResponse,
    MatchmakingAnalysisRequest,
    MatchmakingAnalysisResponse,
    MatchmakingAnalysisStatusResponse,
    NotEnoughMatchesResponse,
)

limiter = Limiter(key_func=get_remote_address)
logger = structlog.get_logger(__name__)

_P = ParamSpec("_P")
_R = TypeVar("_R")


class _RateLimiter(Protocol):
    """The one slowapi capability this module uses, with a usable signature.

    slowapi annotates the decorator `limit` returns as a bare `Callable`, which
    erases the parameter and return types of every endpoint underneath it.
    """

    def limit(
        self, limit_value: str
    ) -> Callable[[Callable[_P, _R]], Callable[_P, _R]]: ...


def rate_limit(
    rule: str, rate_limiter: _RateLimiter = limiter
) -> Callable[[Callable[_P, _R]], Callable[_P, _R]]:
    """Apply slowapi's rate limit while keeping the endpoint's own signature."""
    return rate_limiter.limit(rule)


router = APIRouter(
    prefix="/matchmaking-analysis",
    tags=["matchmaking-analysis"],
    dependencies=[Depends(get_current_active_user)],
)


@router.post(
    "/check-matches",
    response_model=dict | NotEnoughMatchesResponse,
)
@rate_limit("20/minute")
async def check_player_matches(
    request: Request,
    payload: MatchmakingAnalysisRequest,
    service: MatchmakingServiceDep,
):
    """
    Check if player has enough matches for analysis.

    Returns success=true if player has at least 10 ranked matches.
    """
    try:
        has_enough, match_count = await service.check_player_has_enough_matches(
            payload.puuid
        )
        if has_enough:
            return {"success": True, "matches_found": match_count}
        return NotEnoughMatchesResponse(matches_found=match_count)
    except (AuthenticationError, ForbiddenError) as error:
        logger.warning(
            "matchmaking_match_check_api_key_invalid",
            error_type=type(error).__name__,
        )
        raise HTTPException(
            status_code=503,
            detail=RIOT_API_KEY_INVALID_DETAIL,
        ) from error
    except Exception as error:
        logger.warning(
            "matchmaking_match_check_failed",
            error_type=type(error).__name__,
            exc_info=True,
        )
        raise HTTPException(
            status_code=502,
            detail="Match availability could not be checked. Please try again.",
        ) from error


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
        logger.error(
            "matchmaking_analysis_start_failed",
            error_type=type(error).__name__,
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail="The analysis could not be started. Please try again.",
        ) from error


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
