"""Match API endpoints for the Riot API application."""

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
