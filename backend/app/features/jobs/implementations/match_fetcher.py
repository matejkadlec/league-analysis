from typing import List
import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.jobs.base import BaseJob
from app.features.players.service import PlayerService
from app.features.players.schemas import PlayerResponse
from app.features.matches.service import MatchService
from app.core.riot_api.client import RiotAPIClient, APICallRecord
from app.core.riot_api.db_rate_limiter import DBRateLimiter, RateLimitComponent
from app.core.config import get_riot_api_key
from app.core.riot_api.errors import AuthenticationError
from app.features.players.models import Player
from app.features.jobs.queue_config import get_enabled_match_fetcher_queue_ids

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


class MatchFetcherJob(BaseJob):
    """Job to fetch matches for tracked players and update their leagues."""

    def __init__(self, job_config_id: int, triggered_by: str = "system"):
        super().__init__(job_config_id, triggered_by)

    def _track_api_request(self, metric_name: str, count: int) -> None:
        """Callback for tracking API requests from RiotAPIClient."""
        if metric_name == "requests_made":
            self.metrics["api_requests_made"] += count

    def _store_api_calls(self, api_calls: List[APICallRecord]) -> None:
        """Store API call records from the RiotAPIClient."""
        self._api_call_records = api_calls

    async def execute(self, db: AsyncSession) -> None:
        """Execute the match fetcher job."""
        if not self.job_config:
            raise RuntimeError("Match Fetcher missing job configuration")

        enabled_queue_ids = get_enabled_match_fetcher_queue_ids(
            self.job_config.config_json
        )
        self.add_log_entry("enabled_queue_ids", enabled_queue_ids)

        if not enabled_queue_ids:
            logger.info(
                "Skipping Match Fetcher - no queues enabled",
                job_config_id=self.job_config_id,
            )
            return

        # Initialize services
        # Retrieve API key dynamically (DB prioritized > Env fallback)
        api_key = await get_riot_api_key(db)

        player_service = PlayerService(db)
        match_service = MatchService(db)

        # Initialize DB rate limiter for coordinated rate limiting
        rate_limiter = DBRateLimiter(db, RateLimitComponent.MATCH_FETCHER)

        async with RiotAPIClient(
            api_key=api_key,
            request_callback=self._track_api_request,
        ) as riot_client:
            # Get tracked players
            tracked_players = await player_service.get_globally_tracked_players()
            logger.info(
                "Starting match fetcher job", tracked_count=len(tracked_players)
            )

            try:
                for player in tracked_players:
                    await self.check_control_state(db)
                    try:
                        await self._process_player(
                            db,
                            player,
                            player_service,
                            match_service,
                            riot_client,
                            rate_limiter,
                            enabled_queue_ids,
                        )
                    except Exception as e:
                        error_msg = str(e)
                        is_api_key_err = _is_api_key_error(e)
                        logger.error(
                            "Error processing player",
                            puuid=player.puuid,
                            error=error_msg,
                        )
                        self.record_error(error_msg, is_api_key_error=is_api_key_err)
                        # If it's an API key error, stop processing more players
                        if is_api_key_err:
                            logger.error(
                                "API key error detected, stopping job execution"
                            )
                            break
                        continue
            finally:
                # Release rate limiter when done
                await rate_limiter.release()

            # Store API call records from the client
            self._store_api_calls(riot_client.get_api_calls())

    async def _process_player(
        self,
        db: AsyncSession,
        player: "PlayerResponse",
        player_service: PlayerService,
        match_service: MatchService,
        riot_client: RiotAPIClient,
        rate_limiter: DBRateLimiter,
        enabled_queue_ids: list[int],
    ) -> None:
        """Fetch and sync matches for a single player, then update their league.

        Note: Player profile updates (game_name, tag_line, profile_icon_id, summoner_level)
        are handled by the separate PlayerUpdaterJob which runs less frequently (every 24h).
        """
        # Fetch new matches with rate limiting
        count = await match_service.sync_matches_for_player(
            riot_client,
            player,
            rate_limiter,
            enabled_queue_ids=enabled_queue_ids,
        )
        self.metrics["records_created"] += count

        # Need to get the Player model, not PlayerResponse
        player_model = await db.get(Player, player.puuid)
        if not player_model:
            return

        # Update player league (will only insert if league has changed)
        try:
            # Acquire rate limit before league API call
            can_proceed = await rate_limiter.acquire()
            if not can_proceed:
                logger.warning(
                    "Rate limit exceeded, skipping league update",
                    puuid=player.puuid,
                )
                return

            league_updated = await player_service.update_player_league(
                player_model, riot_client
            )

            # Record the request
            await rate_limiter.record_request()

            # Commit league updates
            await db.commit()
            if league_updated:
                self.metrics["records_updated"] += 1
                logger.info(
                    "Player league updated",
                    puuid=player.puuid,
                    game_name=player.game_name,
                )
        except Exception as e:
            error_msg = str(e)
            is_api_key_err = _is_api_key_error(e)
            logger.error(
                "Error updating player league",
                puuid=player.puuid,
                error=error_msg,
            )
            self.record_error(
                f"Failed to update player league: {error_msg}",
                is_api_key_error=is_api_key_err,
            )
            if is_api_key_err:
                raise  # Re-raise to stop processing
