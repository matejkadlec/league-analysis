"""Player Updater Job - Updates player profiles (name, tag, icon, level) for tracked players."""

from typing import override

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db_session import rollback_quietly
from app.core.riot_api.client import RiotAPIClient
from app.core.riot_api.errors import RateLimitError
from app.features.jobs.base import BaseJob, JobStopSignal
from app.features.jobs.error_handling import (
    RateLimitSignal,
)
from app.features.jobs.maintenance import RiotWriterMaintenanceActiveError
from app.features.players.models import Player
from app.features.players.service import PlayerService

logger = structlog.get_logger(__name__)


class PlayerUpdaterJob(BaseJob):
    """Job to update player profiles (game_name, tag_line, profile_icon_id, summoner_level).

    Calls summoner-v4 by-puuid (profile_icon_id, summoner_level) and
    account-v1 by-puuid (game_name, tag_line). Should run infrequently
    (e.g., every 24 hours) as player profiles don't change often.
    """

    recorded_errors_are_fatal = False

    @override
    async def execute(self, db: AsyncSession) -> None:
        """Execute the player updater job."""

        player_service = PlayerService(db)

        async with self.job_riot_client(db) as riot_client:
            tracked_puuids = await self._load_tracked_puuids(db)
            logger.info(
                "Starting player updater job", tracked_count=len(tracked_puuids)
            )

            for puuid in tracked_puuids:
                await self.check_control_state(db)
                try:
                    # Re-read per iteration: a recoverable error rolls the
                    # session back, which expires every row it holds.
                    player = await db.get(Player, puuid)
                    if player is None:
                        logger.warning("Tracked player is gone", puuid=puuid)
                        continue
                    await self._update_player_profile(
                        db, player, player_service, riot_client
                    )
                except RateLimitError as error:
                    raise RateLimitSignal(
                        retry_after=error.retry_after,
                        message="Rate limit reached while updating players",
                    ) from error
                except RiotWriterMaintenanceActiveError as error:
                    await rollback_quietly(db)
                    raise JobStopSignal(reason="riot_maintenance") from error
                except Exception as e:
                    if await self.handle_player_error(
                        db,
                        e,
                        message="Error updating player profile",
                        operation="player profile update",
                        puuid=puuid,
                    ):
                        break

    async def _update_player_profile(
        self,
        db: AsyncSession,
        player: Player,
        player_service: PlayerService,
        riot_client: RiotAPIClient,
    ) -> None:
        """Update profile for a single player (game_name, tag_line, profile_icon_id, summoner_level)."""
        profile_updated = await player_service.update_player_profile(
            player, riot_client
        )

        await db.commit()

        if profile_updated:
            self.metrics["records_updated"] += 1
            logger.info(
                "Player profile updated",
                puuid=player.puuid,
                game_name=player.game_name,
                tag_line=player.tag_line,
                profile_icon_id=player.profile_icon_id,
                summoner_level=player.summoner_level,
            )
        else:
            logger.debug(
                "Player profile unchanged",
                puuid=player.puuid,
                game_name=player.game_name,
            )
