"""Matchmaking analysis API endpoints."""

from datetime import datetime
from typing import Union

from fastapi import APIRouter, HTTPException

from .schemas import (
    MatchmakingAnalysisRequest,
    MatchmakingAnalysisResponse,
    MatchmakingAnalysisStatusResponse,
    MatchmakingAnalysisHistoryResponse,
    NotEnoughMatchesResponse,
)
from .dependencies import MatchmakingServiceDep

router = APIRouter(prefix="/matchmaking-analysis", tags=["matchmaking-analysis"])


@router.post(
    "/check-matches",
    response_model=Union[dict, NotEnoughMatchesResponse],
)
async def check_player_matches(
    request: MatchmakingAnalysisRequest,
    service: MatchmakingServiceDep,
):
    """
    Check if player has enough matches for analysis.

    Returns success=true if player has at least 10 ranked matches.
    """
    try:
        has_enough, match_count = await service.check_player_has_enough_matches(
            request.puuid
        )
        if has_enough:
            return {"success": True, "matches_found": match_count}
        return NotEnoughMatchesResponse(matches_found=match_count)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/start", response_model=MatchmakingAnalysisResponse)
async def start_analysis(
    request: MatchmakingAnalysisRequest,
    service: MatchmakingServiceDep,
):
    """
    Start a new matchmaking analysis for a player.

    This will analyze the player's last 10 ranked matches and calculate
    average winrates for teammates vs enemies.

    The analysis runs in the background and will continue even if the
    user navigates away from the page.
    """
    try:
        # First check if player has enough matches
        has_enough, match_count = await service.check_player_has_enough_matches(
            request.puuid
        )
        if not has_enough:
            raise HTTPException(
                status_code=400,
                detail=f"Player doesn't have enough matches for this analysis. Found {match_count}, need 10.",
            )

        return await service.start_analysis(request.puuid)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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


@router.get("/player/{puuid}/status", response_model=MatchmakingAnalysisStatusResponse)
async def get_analysis_status_by_puuid(
    puuid: str,
    service: MatchmakingServiceDep,
):
    """Get status of the latest analysis for a player."""
    result = await service.get_latest_analysis(puuid)

    if not result:
        raise HTTPException(status_code=404, detail="No analysis found for this player")

    return MatchmakingAnalysisStatusResponse(
        puuid=result.puuid,
        status=result.status,
        progress=result.progress,
        total_puuids=result.total_puuids,
        results=result.results,
        created_at=result.created_at,
        requests_saved=result.requests_saved,
        rate_limit_wait_seconds=result.rate_limit_wait_seconds,
    )


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
