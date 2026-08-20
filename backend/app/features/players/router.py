"""Player API endpoints for the Riot API application."""

import re
from datetime import UTC
from typing import Annotated, NoReturn

import structlog
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request

from app.core.dependencies import get_riot_client
from app.core.rate_limiter import rate_limit
from app.core.riot_api.client import RiotAPIClient
from app.core.riot_api.constants import Platform
from app.core.riot_api.errors import (
    RIOT_API_KEY_INVALID_DETAIL,
    AuthenticationError,
    ForbiddenError,
    NotFoundError,
    RateLimitError,
)
from app.features.auth.dependencies import get_current_active_user
from app.features.auth.models import User
from app.features.jobs.models import PlayerSyncRun
from app.features.jobs.player_sync import (
    create_or_get_player_sync,
    get_active_player_sync,
    run_player_sync,
)

from .dependencies import (
    PlayerServiceDep,
    get_player_service,
)
from .leagues_schemas import PlayerLeagueResponse
from .schemas import (
    CurrentPlayerUpdate,
    PlayerContextResponse,
    PlayerResponse,
    PlayerSyncRunResponse,
)

logger = structlog.get_logger(__name__)


router = APIRouter(prefix="/players", tags=["players"])


def _log_and_raise_500(
    e: Exception, event: str, detail: str, **context: object
) -> NoReturn:
    """Log the unexpected error with its context and answer a client-safe 500."""
    logger.error(event, error=str(e), exc_info=e, **context)
    raise HTTPException(status_code=500, detail=detail) from e


router.get_player_service = get_player_service  # type: ignore[attr-defined]

# Game name and Tag line constants
GAME_NAME_MAX_LENGTH = 16
TAG_LINE_MAX_LENGTH = 5


def _validate_game_name(game_name: str) -> None:
    """Validate game name length and characters."""
    if not game_name:
        raise HTTPException(status_code=400, detail="Game name cannot be empty")

    if len(game_name) > GAME_NAME_MAX_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Game name is too long ({GAME_NAME_MAX_LENGTH} characters max).",
        )

    if not re.match(r"^[a-zA-Z0-9\s\.\-_]+$", game_name):
        raise HTTPException(
            status_code=400,
            detail="Game name contains unsupported characters. Use letters, numbers, spaces, and ._-.",
        )


def _validate_tag_line(tag_line: str) -> None:
    """Validate tag line length and characters."""
    if not tag_line:
        raise HTTPException(status_code=400, detail="Tag line cannot be empty")

    if len(tag_line) > TAG_LINE_MAX_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Tag line is too long ({TAG_LINE_MAX_LENGTH} characters max).",
        )

    if not re.match(r"^[a-zA-Z0-9]+$", tag_line):
        raise HTTPException(
            status_code=400,
            detail="Tag line contains unsupported characters. Use only letters and numbers.",
        )


@router.get("/search", response_model=list[PlayerResponse])
@rate_limit("100/minute")
async def search_player(
    request: Request,
    player_service: PlayerServiceDep,
    current_user: User = Depends(get_current_active_user),
    query: str = Query(
        ...,
        min_length=3,
        max_length=30,
        description="Search query (game name, tag line or both)",
    ),
    platform: Platform | None = Query(
        None, description="Optional platform filter (e.g. EUN1)"
    ),
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
            platform=platform.value if platform else None,
            limit=10,
            user_id=current_user.id,
        )
        if not results:
            logger.debug(
                "No player search results",
                query=query,
                platform=platform.value if platform else None,
            )
        return results

    except Exception as e:
        _log_and_raise_500(
            e,
            "player_search_failed",
            "Player search could not be completed. Please try again later.",
            query=query,
            platform=platform.value if platform else None,
        )


@router.get("/suggestions", response_model=list[PlayerResponse])
async def get_player_suggestions(
    request: Request,
    player_service: PlayerServiceDep,
    current_user: User = Depends(get_current_active_user),
    q: str = Query(
        ...,
        min_length=0,
        max_length=30,
        description="Search query (name, tag, or Name#Tag)",
    ),
    platform: Platform | None = Query(
        None, description="Optional platform filter (e.g. EUN1)"
    ),
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
        GET /api/v1/players/suggestions?q=Danger&platform=eun1
        GET /api/v1/players/suggestions?q=John Doe#EUNE&platform=eun1&limit=3
        GET /api/v1/players/suggestions?q=#EUNE&platform=eun1&limit=10
    """
    try:
        results = await player_service.fuzzy_search_players(
            query=q,
            platform=platform.value if platform else None,
            limit=limit,
            user_id=current_user.id,
        )
        if not results:
            logger.debug(
                "No player suggestions found",
                query=q,
                platform=platform.value if platform else None,
            )
        return results

    except Exception as e:
        _log_and_raise_500(
            e,
            "player_suggestions_failed",
            "Player suggestions could not be loaded. Please try again later.",
            platform=platform.value if platform else None,
        )


@router.get("/context", response_model=PlayerContextResponse)
async def get_player_context(
    player_service: PlayerServiceDep,
    current_user: User = Depends(get_current_active_user),
):
    """Get the authenticated user's current and recent tracked players."""
    return await player_service.get_player_context(current_user.id)


@router.put("/context/current", response_model=PlayerContextResponse)
async def update_current_player(
    update: CurrentPlayerUpdate,
    player_service: PlayerServiceDep,
    current_user: User = Depends(get_current_active_user),
):
    """Set the user's default current player without tracking or syncing it."""
    try:
        return await player_service.set_current_player(current_user.id, update.puuid)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.post("/discover", response_model=PlayerResponse)
@rate_limit("30/minute")
async def discover_player(
    request: Request,
    player_service: PlayerServiceDep,
    riot_client: Annotated[RiotAPIClient, Depends(get_riot_client)],
    _current_user: User = Depends(get_current_active_user),
    game_name: str = Query(..., description="Riot game name"),
    tag_line: str = Query(..., description="Riot tag line without #"),
    platform: Platform = Query(..., description="Resolved Riot platform"),
):
    """Resolve a one-field Riot ID after conditional platform selection."""
    try:
        _validate_game_name(game_name)
        _validate_tag_line(tag_line)
        result = await player_service.discover_player(
            riot_client=riot_client,
            game_name=game_name,
            tag_line=tag_line,
            platform=platform.value,
        )
        return result
    except NotFoundError as error:
        raise HTTPException(status_code=404, detail="Player not found") from error
    except RateLimitError as error:
        raise HTTPException(
            status_code=429, detail="Riot API rate limit reached"
        ) from error
    except (AuthenticationError, ForbiddenError) as error:
        raise HTTPException(
            status_code=503,
            detail=RIOT_API_KEY_INVALID_DETAIL,
        ) from error
    except ValueError as error:
        _handle_tracking_value_error(error)
    except HTTPException:
        raise
    except Exception as error:
        logger.error(
            "discover_player_failed",
            game_name=game_name,
            platform=platform.value,
            error_type=type(error).__name__,
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail="Player lookup failed. Please try again later.",
        ) from error


@router.get("/{puuid}", response_model=PlayerResponse)
async def get_player_by_puuid(
    puuid: str,
    player_service: PlayerServiceDep,
    current_user: User = Depends(get_current_active_user),
):
    """Get player information by PUUID."""
    player = await player_service.get_player_by_puuid(puuid, user_id=current_user.id)
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")
    return player


@router.post("/{puuid}/sync", response_model=PlayerSyncRunResponse)
@rate_limit("10/minute")
async def start_player_sync(
    request: Request,
    puuid: str,
    background_tasks: BackgroundTasks,
    player_service: PlayerServiceDep,
    current_user: User = Depends(get_current_active_user),
):
    """Create or attach to one authoritative explicit update for this player."""
    try:
        sync_run, created = await create_or_get_player_sync(
            player_service.db,
            user_id=current_user.id,
            puuid=puuid,
        )
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    if created:
        background_tasks.add_task(run_player_sync, sync_run.id)
    return sync_run


@router.get("/{puuid}/sync/active", response_model=PlayerSyncRunResponse | None)
async def read_active_player_sync(
    puuid: str,
    player_service: PlayerServiceDep,
    _current_user: User = Depends(get_current_active_user),
):
    """Rehydrate the active update for a player after navigation or reload."""
    return await get_active_player_sync(player_service.db, puuid)


@router.get("/{puuid}/sync/{sync_id}", response_model=PlayerSyncRunResponse)
async def read_player_sync(
    puuid: str,
    sync_id: int,
    player_service: PlayerServiceDep,
    _current_user: User = Depends(get_current_active_user),
):
    """Read the exact persisted update run returned by the start endpoint."""
    sync_run = await player_service.db.get(PlayerSyncRun, sync_id)
    if sync_run is None or sync_run.puuid != puuid:
        raise HTTPException(status_code=404, detail="Player update not found")
    return sync_run


# === Player Tracking Endpoints ===


@router.post("/{puuid}/track", response_model=PlayerResponse)
# Same ceiling as POST /{puuid}/sync, because this now starts the same run.
# Deduplication in create_or_get_player_sync caps concurrency per PUUID, not
# rate: tracking several players, or cycling untrack/track after each run
# finishes, would otherwise spend Riot quota past the limit that endpoint was
# deliberately given.
@rate_limit("10/minute")
async def track_player(
    request: Request,
    puuid: str,
    player_service: PlayerServiceDep,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_active_user),
):
    """
    Mark a player for automated tracking and monitoring.

    Tracking alone only adds the player to the Match Fetcher's set, so their
    matches and rank would not arrive until its next scheduled pass — a
    runtime setting, 900s in production at the time of writing. That is a long
    time to look at an empty profile you just added, so this starts the same
    explicit update the Update button does: one claimed PlayerSyncRun, writers
    via BaseJob. If a fleet-wide writer is already running the run reports
    SYNC_BUSY and the scheduler picks the player up on its next pass anyway.

    Returns:
        Updated player data with is_tracked=True

    Raises:
        404: Player not found
        400: Maximum tracked players limit reached
    """
    from app.features.jobs.maintenance import RiotWriterMaintenanceActiveError

    try:
        player = await player_service.track_player(puuid, current_user.id)
    except RiotWriterMaintenanceActiveError as e:
        raise HTTPException(
            status_code=503,
            detail="Riot data maintenance is in progress. Try again after it completes.",
        ) from e
    except ValueError as e:
        if "not found" in str(e).lower():
            raise HTTPException(status_code=404, detail=str(e)) from e
        else:
            # Tracking limit reached or other validation error
            raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        _log_and_raise_500(
            e,
            "track_player_failed",
            "The player could not be tracked. Please try again later.",
            puuid=puuid,
        )

    # The tracking row is committed by here, so claiming the run sits outside
    # the block above on purpose. The sync only saves the viewer from waiting
    # for the Match Fetcher; failing to claim it is no reason to answer that
    # the tracking failed, when it did not and the scheduler will still pick
    # the player up.
    try:
        sync_run, created = await create_or_get_player_sync(
            player_service.db,
            user_id=current_user.id,
            puuid=puuid,
        )
    except Exception as e:
        logger.error(
            "track_player_initial_sync_not_started",
            error=str(e),
            puuid=puuid,
            exc_info=True,
        )
    else:
        if created:
            background_tasks.add_task(run_player_sync, sync_run.id)

    return player


@router.delete("/{puuid}/track", response_model=PlayerResponse)
async def untrack_player(
    puuid: str,
    player_service: PlayerServiceDep,
    current_user: User = Depends(get_current_active_user),
):
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
        player = await player_service.untrack_player(puuid, current_user.id)
        return player
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        _log_and_raise_500(
            e,
            "untrack_player_failed",
            "The player could not be untracked. Please try again later.",
            puuid=puuid,
        )


@router.get("/{puuid}/tracking-status")
async def get_tracking_status(
    puuid: str,
    player_service: PlayerServiceDep,
    current_user: User = Depends(get_current_active_user),
):
    """
    Get the tracking status for a player.

    Returns:
        dict: {'is_tracked': bool}

    Raises:
        404: Player not found
    """
    try:
        is_tracked = await player_service.get_player_tracking_status(
            puuid, current_user.id
        )
        return {"is_tracked": is_tracked}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        _log_and_raise_500(
            e,
            "get_tracking_status_failed",
            "The tracking status could not be loaded. Please try again later.",
            puuid=puuid,
        )


@router.get("/tracked/list", response_model=list[PlayerResponse])
async def get_tracked_players(
    player_service: PlayerServiceDep,
    current_user: User = Depends(get_current_active_user),
):
    """
    Get all players currently marked for tracking.

    Returns:
        List of tracked players with their current data
    """
    try:
        players = await player_service.get_tracked_players(current_user.id)
        return players
    except Exception as e:
        _log_and_raise_500(
            e,
            "get_tracked_players_failed",
            "Tracked players could not be loaded. Please try again later.",
        )


def _handle_tracking_value_error(e: ValueError) -> None:
    """Handle ValueError during player tracking."""
    error_msg = str(e)
    if "not found" in error_msg.lower():
        raise HTTPException(status_code=404, detail=error_msg)
    else:
        raise HTTPException(status_code=400, detail=error_msg)


# === Player League Endpoints ===


@router.post("/{puuid}/refresh-league", response_model=PlayerLeagueResponse | None)
@rate_limit("30/minute")
async def refresh_player_league(
    request: Request,
    puuid: str,
    player_service: PlayerServiceDep,
    riot_client: Annotated[RiotAPIClient, Depends(get_riot_client)],
    _current_user: User = Depends(get_current_active_user),
    queue_type: str = Query(
        "RANKED_SOLO_5x5", description="Queue type to refresh league for"
    ),
):
    """
    Refresh and get the current league for a player from Riot API.

    This endpoint fetches the latest league data from Riot API and stores it.
    Also updates player profile (game_name, tag_line, profile_icon_id, summoner_level).

    Args:
        puuid: Player's PUUID
        queue_type: Queue type (default: RANKED_SOLO_5x5)

    Returns:
        Updated league data or None if no league data exists

    Raises:
        404: Player not found
        500: Database or API error
    """
    from app.features.jobs.maintenance import RiotWriterMaintenanceActiveError

    try:
        # Get the player model (not PlayerResponse) for update_player_league
        from .models import Player

        player_model = await player_service.db.get(Player, puuid)
        if not player_model:
            raise HTTPException(status_code=404, detail="Player not found")

        # Update player profile (game_name, tag_line, profile_icon_id, summoner_level)
        await player_service.update_player_profile(player_model, riot_client)

        # Update league from Riot API (adds record to player_service.db session)
        await player_service.update_player_league(player_model, riot_client)
        from datetime import datetime

        player_model.league_synced_at = datetime.now(UTC)

        # Commit using the same session the service used
        await player_service.db.commit()

        # Return the updated league
        league = await player_service.get_player_league(puuid, queue_type)
        if league:
            return PlayerLeagueResponse.model_validate(league)
        return None
    except HTTPException:
        raise
    except RiotWriterMaintenanceActiveError as e:
        raise HTTPException(
            status_code=503,
            detail="Riot data maintenance is in progress. Try again after it completes.",
        ) from e
    except (AuthenticationError, ForbiddenError) as e:
        logger.error(
            "refresh_player_league_failed",
            error=str(e),
            puuid=puuid,
            exc_info=True,
        )
        raise HTTPException(
            status_code=503,
            detail=RIOT_API_KEY_INVALID_DETAIL,
        ) from e
    except Exception as e:
        # ValueError deliberately lands here too: nothing in this path raises
        # it to mean "not found" (that case returns 404 explicitly above), and
        # mapping it to 404 leaked raw platform/validation errors as missing
        # players.
        _log_and_raise_500(
            e,
            "refresh_player_league_failed",
            "The player's rank could not be refreshed. Please try again later.",
            puuid=puuid,
        )


@router.get("/{puuid}/league", response_model=PlayerLeagueResponse | None)
async def get_player_current_league(
    puuid: str,
    player_service: PlayerServiceDep,
    queue_type: str = Query(
        "RANKED_SOLO_5x5", description="Queue type to fetch league for"
    ),
):
    """
    Get the current league for a player.

    Args:
        puuid: Player's PUUID
        queue_type: Queue type (default: RANKED_SOLO_5x5)

    Returns:
        Current league data or None if no league data exists

    Raises:
        500: Database error
    """
    try:
        league = await player_service.get_player_league(puuid, queue_type)

        if league:
            return PlayerLeagueResponse.model_validate(league)
        return None
    except Exception as e:
        _log_and_raise_500(
            e,
            "get_player_league_failed",
            "The player's rank could not be loaded. Please try again later.",
            puuid=puuid,
            queue_type=queue_type,
        )
