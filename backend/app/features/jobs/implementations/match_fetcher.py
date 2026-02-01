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

logger = structlog.get_logger(__name__)


class MatchFetcherJob(BaseJob):
    """Job to fetch matches for tracked players."""

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
                    await self._process_player(db, player, match_service, riot_client)
                except Exception as e:
                    logger.error(
                        "Error processing player", puuid=player.puuid, error=str(e)
                    )
                    continue

    async def _process_player(
        self,
        db: AsyncSession,
        player: "PlayerResponse",
        match_service: MatchService,
        riot_client: RiotAPIClient,
    ) -> None:
        """Fetch and sync matches for a single player."""
        count = await match_service.sync_matches_for_player(riot_client, player)
        self.metrics["records_created"] += count
