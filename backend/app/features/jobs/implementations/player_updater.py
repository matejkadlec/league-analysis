"""Player Updater Job - Updates player profiles (name, tag, icon, level) for tracked players."""

from typing import override

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.riot_api.client import APICallRecord, RiotAPIClient
from app.core.riot_api.db_rate_limiter import DBRateLimiter, RateLimitComponent
from app.core.riot_api.errors import RateLimitError
from app.features.jobs.base import BaseJob, JobStopSignal
from app.features.jobs.error_handling import (
    RateLimitSignal,
    is_database_job_error,
    is_riot_api_key_error,
)
from app.features.jobs.maintenance import RiotWriterMaintenanceActiveError
from app.features.players.models import Player
from app.features.players.schemas import PlayerResponse
from app.features.players.service import PlayerService

logger = structlog.get_logger(__name__)


class PlayerUpdaterJob(BaseJob):
    """Job to update player profiles (game_name, tag_line, profile_icon_id, summoner_level).

    This job calls:
    - /lol/summoner/v4/summoners/by-puuid/{puuid} - for profile_icon_id and summoner_level
    - /riot/account/v1/accounts/by-puuid/{puuid} - for game_name and tag_line

    Should run less frequently (e.g., every 24 hours) as player profiles don't change often.
    """

    recorded_errors_are_fatal = False

    def __init__(
        self,
        job_config_id: int,
        triggered_by: str = "system",
        target_puuids: set[str] | None = None,
    ):
        super().__init__(job_config_id, triggered_by)
        self.target_puuids = target_puuids

    def _track_api_request(self, metric_name: str, count: int) -> None:
        """Callback for tracking API requests from RiotAPIClient."""
        if metric_name == "requests_made":
            self.metrics["api_requests_made"] += count

    def _store_api_calls(self, api_calls: list[APICallRecord]) -> None:
        """Store API call records from the RiotAPIClient."""
        self._api_call_records = api_calls

    @override
    async def execute(self, db: AsyncSession) -> None:
        """Execute the player updater job."""

        player_service = PlayerService(db)

        # Initialize DB rate limiter - Player Updater has highest priority
        rate_limiter = DBRateLimiter(db, RateLimitComponent.PLAYER_UPDATER)

        async with await self.get_job_riot_api_client(
            db,
            request_callback=self._track_api_request,
        ) as riot_client:
            # Get tracked players
            if self.target_puuids is None:
                tracked_players = await player_service.get_globally_tracked_players()
            else:
                result = await db.execute(
                    select(Player).where(Player.puuid.in_(self.target_puuids))
                )
                tracked_players = [
                    PlayerResponse.model_validate(player)
                    for player in result.scalars().all()
                ]
                self.add_log_entry("target_puuids", sorted(self.target_puuids))
            logger.info(
                "Starting player updater job", tracked_count=len(tracked_players)
            )

            try:
                for player in tracked_players:
                    await self.check_control_state(db)
                    try:
                        await self._update_player_profile(
                            db, player, player_service, riot_client, rate_limiter
                        )
                    except RateLimitSignal:
                        raise
                    except RateLimitError as error:
                        raise RateLimitSignal(
                            retry_after=error.retry_after,
                            message="Rate limit reached while updating players",
                        ) from error
                    except RiotWriterMaintenanceActiveError as error:
                        await db.rollback()
                        raise JobStopSignal(reason="riot_maintenance") from error
                    except Exception as e:
                        is_api_key_err = is_riot_api_key_error(e)
                        logger.error(
                            "Error updating player profile",
                            puuid=player.puuid,
                            error_type=type(e).__name__,
                        )
                        if is_database_job_error(e):
                            await db.rollback()
                            raise
                        self.record_error(
                            e,
                            operation="player profile update",
                            context={"puuid": player.puuid},
                            is_api_key_error=is_api_key_err,
                        )
                        # If it's an API key error, stop processing more players
                        if is_api_key_err:
                            logger.error(
                                "API key error detected, stopping job execution"
                            )
                            break
                        await db.rollback()
                        continue
            finally:
                # Release rate limiter when done
                await rate_limiter.release()

            # Store API call records from the client
            self._store_api_calls(riot_client.get_api_calls())

    async def _update_player_profile(
        self,
        db: AsyncSession,
        player: PlayerResponse,
        player_service: PlayerService,
        riot_client: RiotAPIClient,
        rate_limiter: DBRateLimiter,
    ) -> None:
        """Update profile for a single player (game_name, tag_line, profile_icon_id, summoner_level)."""
        # Need to get the Player model, not PlayerResponse
        player_model = await db.get(Player, player.puuid)
        if not player_model:
            logger.warning("Player model not found", puuid=player.puuid)
            return

        # Acquire rate limit before API calls (2 calls per player)
        can_proceed = await rate_limiter.acquire()
        if not can_proceed:
            raise RateLimitSignal(
                message="Local rate limiter capacity unavailable during player update"
            )

        profile_updated = await player_service.update_player_profile(
            player_model, riot_client
        )

        await db.commit()

        # Record both API calls only after the profile transaction is durable.
        await rate_limiter.record_request()
        await rate_limiter.record_request()

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
