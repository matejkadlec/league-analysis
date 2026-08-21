"""Match API endpoints for the Riot API application."""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

from .dependencies import MatchServiceDep
from .schemas import (
    ChampionStatsResponse,
    LaneStatsResponse,
    MatchListWithPlayerDataResponse,
    MatchStatsResponse,
)

router = APIRouter(prefix="/matches", tags=["matches"])


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


def parse_match_queue_ids(queues: str | None) -> tuple[int, ...] | None:
    """Answer the union filter, or None when the caller named no queues.

    Kept separate from the validation above rather than folded into it: one
    function carries four decision points plus the null check and xenon ranks
    it C, over the B this repo holds itself to.
    """
    return _parse_match_queue_union(queues) if queues is not None else None


@router.get("/player/{puuid}/detailed")
async def get_player_matches_detailed(
    puuid: str,
    match_service: MatchServiceDep,
    queues: Annotated[
        str | None,
        Query(max_length=200, description="Comma-separated queue ID filters"),
    ] = None,
    search: Annotated[
        str | None,
        Query(max_length=64, description="Champion or participant Riot ID search"),
    ] = None,
    start: Annotated[int, Query(ge=0, description="Start index")] = 0,
    count: Annotated[
        int, Query(ge=1, le=1000, description="Number of matches to return")
    ] = 20,
) -> MatchListWithPlayerDataResponse:
    """
    Get detailed match history for a player including champion data,
    lane opponent, and LP changes.
    """
    queue_ids = parse_match_queue_ids(queues)
    return await match_service.get_player_matches_with_data(
        puuid=puuid,
        start=start,
        count=count,
        queue_ids=queue_ids,
        search=search.strip() or None if search is not None else None,
    )


@router.get("/player/{puuid}/stats")
async def get_player_stats(
    puuid: str,
    match_service: MatchServiceDep,
    queues: Annotated[
        str | None,
        Query(max_length=200, description="Comma-separated queue ID filters"),
    ] = None,
    limit: Annotated[
        int | None,
        Query(
            ge=1,
            description="Number of matches to analyze. If not provided, uses all matches.",
        ),
    ] = None,
) -> MatchStatsResponse:
    """
    Get aggregated statistics for a player from recent matches.
    If limit is not provided, all matches in the database will be analyzed.
    """
    queue_ids = parse_match_queue_ids(queues)
    return await match_service.get_player_stats(
        puuid=puuid,
        queue_ids=queue_ids,
        limit=limit,
    )


@router.get("/player/{puuid}/champion-stats")
async def get_player_champion_stats(
    puuid: str,
    match_service: MatchServiceDep,
    queue: Annotated[
        int | None, Query(description="Queue ID filter (e.g., 420 for ranked solo/duo)")
    ] = None,
) -> ChampionStatsResponse:
    """
    Get player statistics grouped by champion.
    Returns every qualifying champion sorted by games played descending.
    """
    return await match_service.get_player_champion_stats(
        puuid=puuid,
        queue=queue,
    )


@router.get("/player/{puuid}/lane-stats")
async def get_player_lane_stats(
    puuid: str,
    match_service: MatchServiceDep,
    queue: Annotated[
        int | None, Query(description="Queue ID filter (e.g., 420 for ranked solo/duo)")
    ] = None,
) -> LaneStatsResponse:
    """
    Get player statistics grouped by lane/position.
    Returns lanes sorted by games played descending.
    """
    return await match_service.get_player_lane_stats(
        puuid=puuid,
        queue=queue,
    )
