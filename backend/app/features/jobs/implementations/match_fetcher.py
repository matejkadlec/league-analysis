from datetime import datetime, timezone
from typing import List

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
from app.features.jobs.queue_config import get_match_fetcher_queue_ids
from app.features.matches.service import MatchService
from app.features.players.models import Player
from app.features.players.schemas import PlayerResponse
from app.features.players.service import PlayerService

logger = structlog.get_logger(__name__)


class MatchFetcherJob(BaseJob):
    """Job to fetch matches for tracked players and update their leagues."""

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

    def _store_api_calls(self, api_calls: List[APICallRecord]) -> None:
        """Store API call records from the RiotAPIClient."""
        self._api_call_records = api_calls

    async def execute(self, db: AsyncSession) -> None:
        """Execute the match fetcher job."""
        if not self.job_config:
            raise RuntimeError("Match Fetcher missing job configuration")

        supported_queue_ids = get_match_fetcher_queue_ids()
        self.add_log_entry("supported_queue_ids", supported_queue_ids)

        # Initialize services
        # Retrieve API key dynamically (DB prioritized > Env fallback)
        api_key = await self.get_job_riot_api_key(db)

        player_service = PlayerService(db)
        match_service = MatchService(db)

        # Initialize DB rate limiter for coordinated rate limiting
        rate_limiter = DBRateLimiter(db, RateLimitComponent.MATCH_FETCHER)

        async with RiotAPIClient(
            api_key=api_key,
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
                        )
                    except RateLimitSignal:
                        raise
                    except RateLimitError as error:
                        raise RateLimitSignal(
                            retry_after=error.retry_after,
                            message="Rate limit reached while fetching matches",
                        ) from error
                    except RiotWriterMaintenanceActiveError as error:
                        await db.rollback()
                        raise JobStopSignal(reason="riot_maintenance") from error
                    except Exception as e:
                        is_api_key_err = is_riot_api_key_error(e)
                        logger.error(
                            "Error processing player",
                            puuid=player.puuid,
                            error_type=type(e).__name__,
                        )
                        if is_database_job_error(e):
                            await db.rollback()
                            raise
                        if is_api_key_err and self.has_api_key_error():
                            break
                        self.record_error(
                            e,
                            operation="player synchronization",
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

    async def _process_player(
        self,
        db: AsyncSession,
        player: "PlayerResponse",
        player_service: PlayerService,
        match_service: MatchService,
        riot_client: RiotAPIClient,
        rate_limiter: DBRateLimiter,
    ) -> None:
        """Fetch and sync matches for a single player, then update their league.

        Note: Player profile updates (game_name, tag_line, profile_icon_id, summoner_level)
        are handled by the separate PlayerUpdaterJob which runs less frequently (every 24h).
        """

        # Fetch new matches with rate limiting
        def record_match_sync_failure(
            operation: str,
            error: Exception,
            context: dict[str, object],
        ) -> None:
            self.record_error(
                error,
                operation=operation,
                context={"puuid": player.puuid, **context},
            )

        error_count_before = len(self._errors_encountered)
        try:
            count = await match_service.sync_matches_for_player(
                riot_client,
                player,
                rate_limiter,
                on_failure=record_match_sync_failure,
            )
        except RateLimitError as error:
            raise RateLimitSignal(
                retry_after=error.retry_after,
                message="Rate limit reached while synchronizing matches",
            ) from error
        self.metrics["records_created"] += count

        # Need to get the Player model, not PlayerResponse
        player_model = await db.get(Player, player.puuid)
        if not player_model:
            return

        if len(self._errors_encountered) == error_count_before:
            player_model.match_synced_at = datetime.now(timezone.utc)
            await db.commit()

        # Update player league (will only insert if league has changed)
        try:
            # Acquire rate limit before league API call
            can_proceed = await rate_limiter.acquire()
            if not can_proceed:
                raise RateLimitSignal(
                    message="Local rate limiter capacity unavailable during league update"
                )

            league_updated = await player_service.update_player_league(
                player_model, riot_client
            )

            player_model.league_synced_at = datetime.now(timezone.utc)

            # Commit league updates
            await db.commit()

            # Record the request only after the domain transaction is durable.
            await rate_limiter.record_request()
            if league_updated:
                self.metrics["records_updated"] += 1
                logger.info(
                    "Player league updated",
                    puuid=player.puuid,
                    game_name=player.game_name,
                )
        except RateLimitError, RateLimitSignal:
            raise
        except Exception as e:
            is_api_key_err = is_riot_api_key_error(e)
            logger.error(
                "Error updating player league",
                puuid=player.puuid,
                error_type=type(e).__name__,
            )
            if is_database_job_error(e):
                await db.rollback()
                raise
            self.record_error(
                e,
                operation="player league update",
                context={"puuid": player.puuid},
                is_api_key_error=is_api_key_err,
            )
            if is_api_key_err:
                raise  # Re-raise to stop processing
            await db.rollback()
