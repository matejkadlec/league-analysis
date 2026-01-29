"""Player API endpoints for the Riot API application."""

import re
from fastapi import APIRouter, HTTPException, Query, Request
from slowapi import Limiter
from slowapi.util import get_remote_address
import structlog

from .schemas import (
    PlayerResponse,
)
from .ranks_schemas import PlayerRankResponse
from .dependencies import (
    PlayerServiceDep,
    get_player_service,
)
from app.core.riot_api.constants import Platform
from app.core.riot_api.client import RiotAPIClient
from app.core.dependencies import get_riot_client
from fastapi import APIRouter, HTTPException, Query, Request, Depends
from typing import Annotated

logger = structlog.get_logger(__name__)

# Rate limiter instance
limiter = Limiter(key_func=get_remote_address)

router = APIRouter(prefix="/players", tags=["players"])
router.get_player_service = get_player_service  # type: ignore[attr-defined]

# Game name and Tag line constants
GAME_NAME_MAX_LENGTH = 16
TAG_LINE_MAX_LENGTH = 5


def _validate_game_name(game_name: str) -> None:
    """Validate game name length and characters."""
    if not game_name:
        raise HTTPException(status_code=400, detail="Game name cannot be empty")

    if len(game_name) > GAME_NAME_MAX_LENGTH:
        raise HTTPException(status_code=400, detail="Game name too long")

    if not re.match(r"^[a-zA-Z0-9\s\.\-_]+$", game_name):
        raise HTTPException(status_code=400, detail="Invalid characters in game name")


def _validate_tag_line(tag_line: str) -> None:
    """Validate tag line length and characters."""
    if not tag_line:
        raise HTTPException(status_code=400, detail="Tag line cannot be empty")

    if len(tag_line) > TAG_LINE_MAX_LENGTH:
        raise HTTPException(status_code=400, detail="Tag line too long")

    if not re.match(r"^[a-zA-Z0-9]+$", tag_line):
        raise HTTPException(status_code=400, detail="Invalid characters in tag line")


@router.get("/search", response_model=list[PlayerResponse])
@limiter.limit("100/minute")
async def search_player(
    request: Request,
    player_service: PlayerServiceDep,
    query: str = Query(
        ...,
        min_length=3,
        max_length=30,
        description="Search query (game name, tag line or both)",
    ),
    platform: Platform = Query(Platform.EUN1, description="Platform (e.g. EUN1)"),
):
    """
    Fuzzy search for players by game name, tag line or both.

    Returns array of matches (empty if none found). Search patterns:
    - "Name#TAG" → Exact match prioritized (Game Name + Tag Line)
    - "#TAG" → Tag only
    - "Name" → Game name
    """
    try:
        results = await player_service.fuzzy_search_players(
            query=query,
            platform=platform.value,
            limit=10,
        )
        if not results:
            logger.debug(
                f"No results found for query: {query}, platform: {platform.value}"
            )
        return results

    except Exception as e:
        # Unexpected error - log and return 500
        logger.error(
            "player_search_failed",
            error=str(e),
            query=query,
            platform=platform.value,
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail="Internal server error during player search",
        )


@router.get("/suggestions", response_model=list[PlayerResponse])
async def get_player_suggestions(
    request: Request,
    player_service: PlayerServiceDep,
    q: str = Query(
        ...,
        min_length=0,
        max_length=30,
        description="Search query (name, tag, or Name#Tag)",
    ),
    platform: Platform = Query(..., description="Platform  (e.g. EUN1)"),
    limit: int = Query(
        5,
        ge=1,
        le=10,
        description="Number of suggestions to return (default: 5, max: 10)",
    ),
):
    """
    Get autocomplete suggestions for player search.

    This endpoint is optimized for autocomplete/typeahead functionality
    and returns a smaller set of top matches (default: 5) for quick response.

    Search patterns:
    - "Name#TAG" → Search for Riot ID (exact match gets highest priority)
    - "#TAG" → Search for tag only
    - "Name" → Search for game name

    Args:
        q: Search string (0-100 characters)
        platform: Platform platform (e.g., "eun1", "euw1", "na1") - required
        limit: Maximum number of suggestions to return (default: 5, max: 10)

    Returns:
        list[PlayerResponse]: Array of up to `limit` matching players,
                              sorted by relevance (empty array if none found)

    Examples:
        GET /players/suggestions?q=Danger&platform=eun1
        GET /players/suggestions?q=John Doe#EUNE&platform=eun1&limit=3
        GET /players/suggestions?q=#EUNE&platform=eun1&limit=10
    """
    try:
        results = await player_service.fuzzy_search_players(
            query=q,
            platform=platform.value,
            limit=limit,
        )
        if not results:
            logger.debug(
                f"No suggestions found for query: {q}, platform: {platform.value}"
            )
        return results

    except Exception as e:
        # Unexpected error - log and return 500
        logger.error(
            "player_suggestions_failed",
            error=str(e),
            platform=platform.value,
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail="Internal server error retrieving player suggestions",
        )


@router.get("/{puuid}", response_model=PlayerResponse)
async def get_player_by_puuid(puuid: str, player_service: PlayerServiceDep):
    """Get player information by PUUID."""
    player = await player_service.get_player_by_puuid(puuid)
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")
    return player


@router.get("/{puuid}/recent-opponents", response_model=list[PlayerResponse])
async def get_player_recent_opponents(
    puuid: str,
    player_service: PlayerServiceDep,
    limit: int = Query(10, ge=1, le=50, description="Number of recent opponents"),
):
    """Get recent opponents for a player with their details (database only, no Riot API calls)."""
    opponents = await player_service.get_recent_opponents_with_details(puuid, limit)
    return opponents


# === Player Tracking Endpoints ===


@router.post("/{puuid}/track", response_model=PlayerResponse)
async def track_player(puuid: str, player_service: PlayerServiceDep):
    """
    Mark a player for automated tracking and monitoring.

    Tracked players will have their match history and rank automatically
    updated every 2 minutes by the background job scheduler.

    Returns:
        Updated player data with is_tracked=True

    Raises:
        404: Player not found
        400: Maximum tracked players limit reached
    """
    try:
        player = await player_service.track_player(puuid)
        return player
    except ValueError as e:
        if "not found" in str(e).lower():
            raise HTTPException(status_code=404, detail=str(e))
        else:
            # Tracking limit reached or other validation error
            raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("track_player_failed", error=str(e), puuid=puuid, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Internal server error tracking player",
        )


@router.delete("/{puuid}/track", response_model=PlayerResponse)
async def untrack_player(puuid: str, player_service: PlayerServiceDep):
    """
    Remove a player from automated tracking.

    The player's data will remain in the database but will no longer
    receive automatic updates.

    Returns:
        Updated player data with is_tracked=False

    Raises:
        404: Player not found
    """
    try:
        player = await player_service.untrack_player(puuid)
        return player
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error("untrack_player_failed", error=str(e), puuid=puuid, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Internal server error untracking player",
        )


@router.get("/{puuid}/tracking-status")
async def get_tracking_status(puuid: str, player_service: PlayerServiceDep):
    """
    Get the tracking status for a player.

    Returns:
        dict: {'is_tracked': bool}

    Raises:
        404: Player not found
    """
    try:
        player = await player_service.get_player_by_puuid(puuid)
        return {"is_tracked": player.is_tracked}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(
            "get_tracking_status_failed", error=str(e), puuid=puuid, exc_info=True
        )
        raise HTTPException(
            status_code=500,
            detail="Internal server error retrieving tracking status",
        )


@router.get("/tracked/list", response_model=list[PlayerResponse])
async def get_tracked_players(player_service: PlayerServiceDep):
    """
    Get all players currently marked for tracking.

    Returns:
        List of tracked players with their current data
    """
    try:
        players = await player_service.get_tracked_players()
        return players
    except Exception as e:
        logger.error("get_tracked_players_failed", error=str(e), exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Internal server error retrieving tracked players",
        )


@router.post("/add-tracked", response_model=PlayerResponse)
async def add_tracked_player(
    player_service: PlayerServiceDep,
    riot_client: Annotated[RiotAPIClient, Depends(get_riot_client)],
    game_name: str = Query(..., description="Game name"),
    tag_line: str = Query(..., description="Tag line (without #)"),
    platform: str = Query("eun1", description="Platform platform"),
):
    """
    Search for a player in Riot API and add them with is_tracked=true.

    Args:
        game_name: Game name
        tag_line: Tag line
        platform: Platform platform (default: eun1)

    Returns:
        Player data with is_tracked=True

    Raises:
        400: Invalid input or tracking limit reached
        404: Player not found in Riot API
        500: Unexpected error
    """
    try:
        # Validate inputs
        _validate_game_name(game_name)
        _validate_tag_line(tag_line)

        return await player_service.add_and_track_player(
            riot_client=riot_client,
            game_name=game_name,
            tag_line=tag_line,
            platform=platform,
        )

    except ValueError as e:
        _handle_tracking_value_error(e)
    except HTTPException:
        raise
    except Exception as e:
        full_id = f"{game_name}#{tag_line}"
        _handle_tracking_unexpected_error(e, full_id, game_name, platform)
        raise HTTPException(
            status_code=500, detail="Internal server error adding tracked player"
        )


def _handle_tracking_value_error(e: ValueError) -> None:
    """Handle ValueError during player tracking."""
    error_msg = str(e)
    if "not found" in error_msg.lower():
        raise HTTPException(status_code=404, detail=error_msg)
    else:
        raise HTTPException(status_code=400, detail=error_msg)


def _handle_tracking_unexpected_error(
    e: Exception, full_id: str | None, game_name: str | None, platform: str
) -> None:
    """Handle unexpected errors during player tracking."""
    logger.error(
        "add_tracked_player_failed",
        error=str(e),
        full_id=full_id,
        game_name=game_name,
        platform=platform,
        exc_info=True,
    )
    raise HTTPException(
        status_code=500,
        detail="Internal server error adding tracked player",
    )


# === Player Rank Endpoints ===


@router.get("/{puuid}/rank", response_model=PlayerRankResponse | None)
async def get_player_current_rank(
    puuid: str,
    player_service: PlayerServiceDep,
    queue_type: str = Query(
        "RANKED_SOLO_5x5", description="Queue type to fetch rank for"
    ),
):
    """
    Get the current rank for a player.

    Args:
        puuid: Player's PUUID
        queue_type: Queue type (default: RANKED_SOLO_5x5)

    Returns:
        Current rank data or None if no rank data exists

    Raises:
        500: Database error
    """
    try:
        rank = await player_service.get_player_rank(puuid, queue_type)

        if rank:
            return PlayerRankResponse.model_validate(rank)
        return None
    except Exception as e:
        logger.error(
            "get_player_rank_failed",
            error=str(e),
            puuid=puuid,
            queue_type=queue_type,
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail="Internal server error retrieving player rank",
        )
