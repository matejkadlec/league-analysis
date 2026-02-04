"""Player Updater Job - Updates player profiles (name, tag, icon, level) for tracked players."""

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.jobs.base import BaseJob
from app.features.players.service import PlayerService
from app.features.players.schemas import PlayerResponse
from app.core.riot_api.client import RiotAPIClient, APICallRecord
from app.core.config import get_riot_api_key
from app.core.riot_api.errors import AuthenticationError
from app.features.players.models import Player

logger = structlog.get_logger(__name__)


def _is_api_key_error(error: Exception) -> bool:
    """Check if an error is related to API key authentication."""
    error_str = str(error).lower()
    return (
        isinstance(error, AuthenticationError)
        or "401" in error_str
        or "invalid api key" in error_str
        or "authentication" in error_str
    )


class PlayerUpdaterJob(BaseJob):
    """Job to update player profiles (game_name, tag_line, profile_icon_id, summoner_level).

    This job calls:
    - /lol/summoner/v4/summoners/by-puuid/{puuid} - for profile_icon_id and summoner_level
    - /riot/account/v1/accounts/by-puuid/{puuid} - for game_name and tag_line

    Should run less frequently (e.g., every 24 hours) as player profiles don't change often.
    """

    def __init__(self, job_config_id: int, triggered_by: str = "system"):
        super().__init__(job_config_id, triggered_by)

    def _track_api_request(self, metric_name: str, count: int) -> None:
        """Callback for tracking API requests from RiotAPIClient."""
        if metric_name == "requests_made":
            self.metrics["api_requests_made"] += count

    def _store_api_calls(self, api_calls: list[APICallRecord]) -> None:
        """Store API call records from the RiotAPIClient."""
        self._api_call_records = api_calls

    async def execute(self, db: AsyncSession) -> None:
        """Execute the player updater job."""

        # Retrieve API key dynamically (DB prioritized > Env fallback)
        api_key = await get_riot_api_key(db)

        player_service = PlayerService(db)

        async with RiotAPIClient(
            api_key=api_key,
            request_callback=self._track_api_request,
        ) as riot_client:
            # Get tracked players
            tracked_players = await player_service.get_tracked_players()
            logger.info(
                "Starting player updater job", tracked_count=len(tracked_players)
            )

            for player in tracked_players:
                try:
                    await self._update_player_profile(
                        db, player, player_service, riot_client
                    )
                except Exception as e:
                    error_msg = str(e)
                    is_api_key_err = _is_api_key_error(e)
                    logger.error(
                        "Error updating player profile",
                        puuid=player.puuid,
                        error=error_msg,
                    )
                    self.record_error(error_msg, is_api_key_error=is_api_key_err)
                    # If it's an API key error, stop processing more players
                    if is_api_key_err:
                        logger.error("API key error detected, stopping job execution")
                        break
                    continue

            # Store API call records from the client
            self._store_api_calls(riot_client.get_api_calls())

    async def _update_player_profile(
        self,
        db: AsyncSession,
        player: PlayerResponse,
        player_service: PlayerService,
        riot_client: RiotAPIClient,
    ) -> None:
        """Update profile for a single player (game_name, tag_line, profile_icon_id, summoner_level)."""
        # Need to get the Player model, not PlayerResponse
        player_model = await db.get(Player, player.puuid)
        if not player_model:
            logger.warning("Player model not found", puuid=player.puuid)
            return

        # Update player profile (game_name, tag_line, profile_icon_id, summoner_level)
        try:
            profile_updated = await player_service.update_player_profile(
                player_model, riot_client
            )
            await db.commit()

            if profile_updated:
                self.metrics["records_updated"] += 1
                logger.info(
                    "Player profile updated",
                    puuid=player.puuid,
                    game_name=player_model.game_name,
                    tag_line=player_model.tag_line,
                    profile_icon_id=player_model.profile_icon_id,
                    summoner_level=player_model.summoner_level,
                )
            else:
                logger.debug(
                    "Player profile unchanged",
                    puuid=player.puuid,
                    game_name=player_model.game_name,
                )
        except Exception as e:
            error_msg = str(e)
            is_api_key_err = _is_api_key_error(e)
            logger.error(
                "Error updating player profile",
                puuid=player.puuid,
                error=error_msg,
            )
            self.record_error(
                f"Failed to update player profile: {error_msg}",
                is_api_key_error=is_api_key_err,
            )
            if is_api_key_err:
                raise  # Re-raise to stop processing
