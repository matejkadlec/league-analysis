"""Player API endpoints for the Riot API application."""

from typing import Annotated

import structlog
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request

from app.core.dependencies import get_riot_client
from app.core.http_rate_limit import rate_limit
from app.core.riot_api.client import RiotAPIClient
from app.core.riot_api.constants import Platform
from app.core.riot_api.errors import (
    RIOT_API_KEY_INVALID_DETAIL,
    AuthenticationError,
    ForbiddenError,
    NotFoundError,
    RateLimitError,
)
from app.features.auth.dependencies import CurrentUserDep
from app.features.jobs.maintenance import RiotWriterMaintenanceActiveError
from app.features.jobs.models import PlayerSyncRun
from app.features.jobs.player_sync import (
    SyncBusyError,
    create_or_get_player_sync,
    get_active_player_sync,
    run_player_sync,
)

from .dependencies import PlayerServiceDep
from .leagues import PlayerLeague
from .leagues_schemas import PlayerLeagueResponse
from .schemas import (
    CurrentPlayerUpdate,
    PlayerContextResponse,
    PlayerResponse,
    PlayerSyncRunResponse,
)
from .service import (
    PlayerNotFoundError,
    TrackingLimitReachedError,
)

logger = structlog.get_logger(__name__)


router = APIRouter(prefix="/players", tags=["players"])


@router.get("/suggestions")
async def get_player_suggestions(
    request: Request,
    player_service: PlayerServiceDep,
    current_user: CurrentUserDep,
    q: Annotated[
        str,
        Query(
            min_length=0,
            max_length=30,
            description="Search query (name, tag, or Name#Tag)",
        ),
    ],
    platform: Annotated[
        Platform | None, Query(description="Optional platform filter (e.g. EUN1)")
    ] = None,
    limit: Annotated[
        int,
        Query(
            ge=1,
            le=10,
            description="Number of suggestions to return (default: 5, max: 10)",
        ),
    ] = 5,
) -> list[PlayerResponse]:
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
    results = await player_service.fuzzy_search_players(
        query=q,
        platform=platform,
        user_id=current_user.id,
        limit=limit,
    )
    if not results:
        logger.debug("No player suggestions found", query=q, platform=platform)
    return results


@router.get("/context")
async def get_player_context(
    player_service: PlayerServiceDep,
    current_user: CurrentUserDep,
) -> PlayerContextResponse:
    """Get the authenticated user's current and recent tracked players."""
    return await player_service.get_player_context(current_user.id)


@router.put("/context/current")
async def update_current_player(
    update: CurrentPlayerUpdate,
    player_service: PlayerServiceDep,
    current_user: CurrentUserDep,
) -> PlayerContextResponse:
    """Set the user's default current player without tracking or syncing it."""
    try:
        return await player_service.set_current_player(current_user.id, update.puuid)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.post("/discover")
@rate_limit("30/minute")
async def discover_player(
    request: Request,
    player_service: PlayerServiceDep,
    riot_client: Annotated[RiotAPIClient, Depends(get_riot_client)],
    current_user: CurrentUserDep,
    # The four Riot ID rules used to be 39 lines of imperative checks here
    # and four constants in `frontend/.../riot-id.ts`, with the OpenAPI
    # document publishing neither. Declared, they reach the document and the
    # frontend can be checked against them.
    game_name: Annotated[
        str,
        Query(
            min_length=1,
            max_length=16,
            pattern=r"^[a-zA-Z0-9\s._-]+$",
            description="Riot game name",
        ),
    ],
    tag_line: Annotated[
        str,
        Query(
            min_length=1,
            max_length=5,
            pattern=r"^[a-zA-Z0-9]+$",
            description="Riot tag line without #",
        ),
    ],
    platform: Annotated[Platform, Query(description="Resolved Riot platform")],
) -> PlayerResponse:
    """Resolve a one-field Riot ID after conditional platform selection."""
    try:
        result = await player_service.discover_player(
            riot_client=riot_client,
            game_name=game_name,
            tag_line=tag_line,
            platform=platform,
            user_id=current_user.id,
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
    except PlayerNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.get("/{puuid}")
async def get_player_by_puuid(
    puuid: str,
    player_service: PlayerServiceDep,
    current_user: CurrentUserDep,
) -> PlayerResponse:
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
    current_user: CurrentUserDep,
) -> PlayerSyncRun:
    """Create or attach to one authoritative explicit update for this player."""
    try:
        sync_run, created = await create_or_get_player_sync(
            player_service.db,
            user_id=current_user.id,
            puuid=puuid,
        )
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except SyncBusyError as error:
        # A refusal, not a failure: no run was created, and the frontend
        # reads the code to report it as "showing stored data" rather than
        # as an error (`usePlayerProfileUpdate`).
        raise HTTPException(
            status_code=409,
            detail={"code": "SYNC_BUSY", "message": error.message},
        ) from error
    if created:
        background_tasks.add_task(run_player_sync, sync_run.id)
    return sync_run


@router.get("/{puuid}/sync/active", response_model=PlayerSyncRunResponse | None)
async def read_active_player_sync(
    puuid: str,
    player_service: PlayerServiceDep,
    _current_user: CurrentUserDep,
) -> PlayerSyncRun | None:
    """Rehydrate the active update for a player after navigation or reload."""
    return await get_active_player_sync(player_service.db, puuid)


@router.get("/{puuid}/sync/{sync_id}", response_model=PlayerSyncRunResponse)
async def read_player_sync(
    puuid: str,
    sync_id: int,
    player_service: PlayerServiceDep,
    _current_user: CurrentUserDep,
) -> PlayerSyncRun:
    """Read the exact persisted update run returned by the start endpoint."""
    sync_run = await player_service.db.get(PlayerSyncRun, sync_id)
    if sync_run is None or sync_run.puuid != puuid:
        raise HTTPException(status_code=404, detail="Player update not found")
    return sync_run


# === Player Tracking Endpoints ===


@router.post("/{puuid}/track")
# Same ceiling as POST /{puuid}/sync, because this starts the same run.
# Deduplication in create_or_get_player_sync caps concurrency per PUUID, not
# rate: tracking several players, or cycling untrack/track, would otherwise
# spend Riot quota past the limit that endpoint was deliberately given.
@rate_limit("10/minute")
async def track_player(
    request: Request,
    puuid: str,
    player_service: PlayerServiceDep,
    background_tasks: BackgroundTasks,
    current_user: CurrentUserDep,
) -> PlayerResponse:
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
    try:
        player = await player_service.track_player(puuid, current_user.id)
    except RiotWriterMaintenanceActiveError as e:
        raise HTTPException(
            status_code=503,
            detail="Riot data maintenance is in progress. Try again after it completes.",
        ) from e
    except PlayerNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except TrackingLimitReachedError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    # The tracking row is committed by here, so claiming the run sits outside the
    # block above on purpose: the sync only saves the viewer from waiting for the
    # Match Fetcher, and failing to claim it is no reason to answer that tracking
    # failed when it did not and the scheduler will still pick the player up.
    try:
        sync_run, created = await create_or_get_player_sync(
            player_service.db,
            user_id=current_user.id,
            puuid=puuid,
        )
    except SyncBusyError as e:
        # Not an error: the pipeline is busy, the tracking still succeeded,
        # and the scheduler's next pass covers the player.
        logger.info(
            "track_player_initial_sync_busy",
            reason=e.message,
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


@router.delete("/{puuid}/track")
async def untrack_player(
    puuid: str,
    player_service: PlayerServiceDep,
    current_user: CurrentUserDep,
) -> PlayerResponse:
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
        return await player_service.untrack_player(puuid, current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.get("/tracked/list")
async def get_tracked_players(
    player_service: PlayerServiceDep,
    current_user: CurrentUserDep,
) -> list[PlayerResponse]:
    """
    Get all players currently marked for tracking.

    Returns:
        List of tracked players with their current data
    """
    return await player_service.get_tracked_players(current_user.id)


# === Player League Endpoints ===


@router.get("/{puuid}/league", response_model=PlayerLeagueResponse | None)
async def get_player_current_league(
    puuid: str,
    player_service: PlayerServiceDep,
    queue_type: Annotated[
        str, Query(description="Queue type to fetch league for")
    ] = "RANKED_SOLO_5x5",
) -> PlayerLeague | None:
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
    return await player_service.get_player_league(puuid, queue_type)
