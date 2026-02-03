import asyncio
from typing import List, Set
import structlog
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.features.jobs.base import BaseJob
from app.features.players.service import PlayerService
from app.features.players.schemas import PlayerResponse
from app.features.matches.service import MatchService
from app.core.riot_api.client import RiotAPIClient
from app.core.config import settings, get_riot_api_key
from app.core.riot_api.constants import get_region_by_platform, QueueType, Region
from app.features.matches.models import Match
from app.features.players.models import Player

logger = structlog.get_logger(__name__)


class MatchFetcherJob(BaseJob):
    """Job to fetch matches for tracked players and update their leagues."""

    def __init__(self, job_config_id: int):
        super().__init__(job_config_id)

    async def execute(self, db: AsyncSession) -> None:
        """Execute the match fetcher job."""

        # Initialize services
        # Retrieve API key dynamically (DB prioritized > Env fallback)
        api_key = await get_riot_api_key(db)

        player_service = PlayerService(db)
        match_service = MatchService(db)

        async with RiotAPIClient(api_key=api_key) as riot_client:
            # Get tracked players
            tracked_players = await player_service.get_tracked_players()
            logger.info(
                "Starting match fetcher job", tracked_count=len(tracked_players)
            )

            for player in tracked_players:
                try:
                    await self._process_player(
                        db, player, player_service, match_service, riot_client
                    )
                except Exception as e:
                    logger.error(
                        "Error processing player", puuid=player.puuid, error=str(e)
                    )
                    continue

    async def _process_player(
        self,
        db: AsyncSession,
        player: "PlayerResponse",
        player_service: PlayerService,
        match_service: MatchService,
        riot_client: RiotAPIClient,
    ) -> None:
        """Fetch and sync matches for a single player, then update their league and profile."""
        # Fetch new matches
        count = await match_service.sync_matches_for_player(riot_client, player)
        self.metrics["records_created"] += count

        # Need to get the Player model, not PlayerResponse
        player_model = await db.get(Player, player.puuid)
        if not player_model:
            return

        # Update player profile (game_name, tag_line, profile_icon_id, summoner_level)
        try:
            profile_updated = await player_service.update_player_profile(
                player_model, riot_client
            )
            if profile_updated:
                logger.info(
                    "Player profile updated",
                    puuid=player.puuid,
                    game_name=player_model.game_name,
                )
        except Exception as e:
            logger.error(
                "Error updating player profile",
                puuid=player.puuid,
                error=str(e),
            )

        # Update player league (will only insert if league has changed)
        try:
            league_updated = await player_service.update_player_league(
                player_model, riot_client
            )
            # Commit both profile and league updates
            await db.commit()
            if league_updated:
                logger.info(
                    "Player league updated",
                    puuid=player.puuid,
                    game_name=player.game_name,
                )
        except Exception as e:
            logger.error(
                "Error updating player league",
                puuid=player.puuid,
                error=str(e),
            )
