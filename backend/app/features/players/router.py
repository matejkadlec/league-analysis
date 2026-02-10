"""Player API endpoints for the Riot API application."""

import re
import os
from fastapi import APIRouter, HTTPException, Query, Request, Depends, BackgroundTasks
from typing import Annotated
from slowapi import Limiter
from slowapi.util import get_remote_address
import structlog

from .schemas import (
    PlayerResponse,
)
from .leagues_schemas import PlayerLeagueResponse
from .dependencies import (
    PlayerServiceDep,
    get_player_service,
)
from app.core.riot_api.constants import Platform
from app.core.riot_api.client import RiotAPIClient
from app.core.riot_api.errors import AuthenticationError
from app.core.dependencies import get_riot_client
from app.core.database import db_manager
from app.features.matches.service import MatchService
from app.features.players.service import PlayerService
from app.core.config import settings
from app.features.auth.dependencies import get_current_active_user
from app.features.auth.models import User

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
    current_user: User = Depends(get_current_active_user),
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
            user_id=current_user.id,
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
    current_user: User = Depends(get_current_active_user),
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
            user_id=current_user.id,
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
async def track_player(
    puuid: str,
    player_service: PlayerServiceDep,
    current_user: User = Depends(get_current_active_user),
):
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
        player = await player_service.track_player(puuid, current_user.id)
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
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error("untrack_player_failed", error=str(e), puuid=puuid, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Internal server error untracking player",
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
        logger.error("get_tracked_players_failed", error=str(e), exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Internal server error retrieving tracked players",
        )


async def run_background_match_sync(puuid: str, platform: str):
    """
    Background task to sync matches.
    Also creates a JobExecution entry so it appears in the Jobs dashboard.
    """
    async with db_manager.get_session() as session:
        # 1. Create Job Execution Record
        # We need to find the Match Fetcher job configuration first
        from app.features.jobs.models import (
            JobConfiguration,
            JobType,
            JobExecution,
            JobStatus,
        )
        from sqlalchemy import select, func

        stmt = (
            select(JobConfiguration)
            .where(JobConfiguration.job_type == JobType.MATCH_FETCHER)
            .limit(1)
        )
        result = await session.execute(stmt)
        job_config = result.scalar_one_or_none()

        job_execution = None
        if job_config:
            job_execution = JobExecution(
                job_config_id=job_config.id,
                status=JobStatus.RUNNING,
                started_at=func.now(),
                api_requests_made=0,
                records_created=0,
                records_updated=0,
                execution_log={"trigger": "new_player_added", "puuid": puuid},
            )
            session.add(job_execution)
            await session.commit()
            await session.refresh(job_execution)

        # 2. Run the Sync Logic
        api_key = getattr(settings, "riot_api_key", os.getenv("RIOT_API_KEY"))
        riot_client = RiotAPIClient(api_key=api_key)

        try:
            match_service = MatchService(session)
            # Create a simple object with attributes
            player_obj = type("PlayerObj", (), {"puuid": puuid, "platform": platform})

            logger.info("Starting background match sync", puuid=puuid)
            count = await match_service.sync_matches_for_player(riot_client, player_obj)
            logger.info("Background match sync completed", puuid=puuid, count=count)

            # 3. Update Job Execution on Success
            if job_execution:
                job_execution.status = JobStatus.SUCCESS
                job_execution.completed_at = func.now()
                job_execution.records_created = count
                job_execution.detailed_logs = {
                    "message": f"Synced {count} matches for new player"
                }
                await session.commit()

        except Exception as e:
            logger.error("Background match sync failed", puuid=puuid, error=str(e))
            # 4. Update Job Execution on Failure
            if job_execution:
                job_execution.status = JobStatus.FAILED
                job_execution.completed_at = func.now()
                job_execution.error_message = str(e)
                await session.commit()
        finally:
            await riot_client.close()


async def run_background_player_update(puuid: str, platform: str):
    """
    Background task to update player profile (name, tag, icon, level).
    Also creates a JobExecution entry so it appears in the Jobs dashboard.
    """
    async with db_manager.get_session() as session:
        from app.features.jobs.models import (
            JobConfiguration,
            JobType,
            JobExecution,
            JobStatus,
        )
        from app.features.players.models import Player
        from sqlalchemy import select, func

        # Find the Player Updater job configuration
        stmt = (
            select(JobConfiguration)
            .where(JobConfiguration.job_type == JobType.PLAYER_UPDATER)
            .limit(1)
        )
        result = await session.execute(stmt)
        job_config = result.scalar_one_or_none()

        job_execution = None
        if job_config:
            job_execution = JobExecution(
                job_config_id=job_config.id,
                status=JobStatus.RUNNING,
                started_at=func.now(),
                api_requests_made=0,
                records_created=0,
                records_updated=0,
                execution_log={"trigger": "new_player_added", "puuid": puuid},
            )
            session.add(job_execution)
            await session.commit()
            await session.refresh(job_execution)

        # Run the player update logic
        api_key = getattr(settings, "riot_api_key", os.getenv("RIOT_API_KEY"))
        riot_client = RiotAPIClient(api_key=api_key)

        try:
            player_service = PlayerService(session)
            player_model = await session.get(Player, puuid)

            if not player_model:
                logger.warning("Player not found for profile update", puuid=puuid)
                if job_execution:
                    job_execution.status = JobStatus.FAILED
                    job_execution.completed_at = func.now()
                    job_execution.error_message = "Player not found"
                    await session.commit()
                return

            logger.info("Starting background player profile update", puuid=puuid)
            profile_updated = await player_service.update_player_profile(
                player_model, riot_client
            )

            # Also update league info
            league_updated = await player_service.update_player_league(
                player_model, riot_client
            )
            await session.commit()

            logger.info(
                "Background player profile update completed",
                puuid=puuid,
                profile_updated=profile_updated,
                league_updated=league_updated,
            )

            # Update Job Execution on Success
            if job_execution:
                job_execution.status = JobStatus.SUCCESS
                job_execution.completed_at = func.now()
                job_execution.records_updated = (
                    1 if profile_updated or league_updated else 0
                )
                job_execution.detailed_logs = {
                    "message": f"Updated profile for new player",
                    "profile_updated": profile_updated,
                    "league_updated": league_updated,
                }
                await session.commit()

        except Exception as e:
            logger.error("Background player update failed", puuid=puuid, error=str(e))
            if job_execution:
                job_execution.status = JobStatus.FAILED
                job_execution.completed_at = func.now()
                job_execution.error_message = str(e)
                await session.commit()
        finally:
            await riot_client.close()


@router.post("/add-tracked", response_model=PlayerResponse)
async def add_tracked_player(
    player_service: PlayerServiceDep,
    riot_client: Annotated[RiotAPIClient, Depends(get_riot_client)],
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_active_user),
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

        result = await player_service.add_and_track_player(
            riot_client=riot_client,
            game_name=game_name,
            tag_line=tag_line,
            platform=platform,
            user_id=current_user.id,
        )

        # Trigger background match fetch
        background_tasks.add_task(
            run_background_match_sync, result.puuid, result.platform
        )

        # Trigger background player profile update (name, tag, icon, level, league)
        background_tasks.add_task(
            run_background_player_update, result.puuid, result.platform
        )

        return result

    except ValueError as e:
        _handle_tracking_value_error(e)
    except AuthenticationError as e:
        logger.error("riot_api_auth_error", error=str(e))
        raise HTTPException(
            status_code=503,
            detail="Riot API Key is invalid or expired. Please update it in Settings.",
        )
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


# === Player League Endpoints ===


@router.post("/{puuid}/refresh-league", response_model=PlayerLeagueResponse | None)
@limiter.limit("30/minute")
async def refresh_player_league(
    request: Request,
    puuid: str,
    player_service: PlayerServiceDep,
    riot_client: Annotated["RiotAPIClient", Depends(get_riot_client)],
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
    try:
        # Get the player model (not PlayerResponse) for update_player_league
        from .models import Player

        player_model = await player_service.db.get(Player, puuid)
        if not player_model:
            raise HTTPException(status_code=404, detail="Player not found")

        # Update player profile (game_name, tag_line, profile_icon_id, summoner_level)
        await player_service.update_player_profile(player_model, riot_client)

        # Update league from Riot API (adds record to player_service.db session)
        league_updated = await player_service.update_player_league(
            player_model, riot_client
        )

        # Commit using the same session the service used
        await player_service.db.commit()

        # Return the updated league
        league = await player_service.get_player_league(puuid, queue_type)
        if league:
            return PlayerLeagueResponse.model_validate(league)
        return None
    except HTTPException:
        raise
    except AuthenticationError as e:
        logger.error(
            "refresh_player_league_failed",
            error=str(e),
            puuid=puuid,
            exc_info=True,
        )
        raise HTTPException(
            status_code=503,
            detail="Riot API Key is invalid or expired. Please update it in Settings.",
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(
            "refresh_player_league_failed",
            error=str(e),
            puuid=puuid,
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail="Internal server error refreshing player league",
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
        logger.error(
            "get_player_league_failed",
            error=str(e),
            puuid=puuid,
            queue_type=queue_type,
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail="Internal server error retrieving player league",
        )
