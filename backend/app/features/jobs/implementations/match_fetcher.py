from datetime import UTC, datetime
from typing import override

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.riot_api.client import RiotAPIClient
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
from app.features.matches.match_lp import (
    RANKED_SOLO_QUEUE_ID,
    persist_match_lp_observations,
)
from app.features.matches.service import MatchService
from app.features.players.leagues import PlayerLeague
from app.features.players.models import Player
from app.features.players.schemas import PlayerResponse
from app.features.players.service import PlayerService

logger = structlog.get_logger(__name__)


class MatchFetcherJob(BaseJob):
    """Job to fetch matches for tracked players and update their leagues."""

    recorded_errors_are_fatal = False

    @override
    async def execute(self, db: AsyncSession) -> None:
        """Execute the match fetcher job."""
        if not self.job_config:
            raise RuntimeError("Match Fetcher missing job configuration")

        supported_queue_ids = get_match_fetcher_queue_ids()
        self.add_log_entry("supported_queue_ids", supported_queue_ids)

        player_service = PlayerService(db)
        match_service = MatchService(db)
        rate_limiter = DBRateLimiter(db, RateLimitComponent.MATCH_FETCHER)

        async with self.job_riot_client(db) as riot_client:
            tracked_players = await self._load_tracked_players(db)
            logger.info(
                "Starting match fetcher job", tracked_count=len(tracked_players)
            )
            try:
                await self._process_tracked_players(
                    db,
                    tracked_players,
                    player_service,
                    match_service,
                    riot_client,
                    rate_limiter,
                )
            finally:
                await rate_limiter.release()

    async def _handle_player_processing_error(
        self,
        db: AsyncSession,
        player: PlayerResponse,
        error: Exception,
    ) -> bool:
        """Record a recoverable player error. Return True to stop the job."""
        is_api_key_err = is_riot_api_key_error(error)
        logger.error(
            "Error processing player",
            puuid=player.puuid,
            error_type=type(error).__name__,
        )
        if is_database_job_error(error):
            await db.rollback()
            raise
        if is_api_key_err and self.has_api_key_error():
            return True
        self.record_error(
            error,
            operation="player synchronization",
            context={"puuid": player.puuid},
            is_api_key_error=is_api_key_err,
        )
        if is_api_key_err:
            logger.error("API key error detected, stopping job execution")
            return True
        await db.rollback()
        return False

    async def _process_tracked_players(
        self,
        db: AsyncSession,
        tracked_players: list[PlayerResponse],
        player_service: PlayerService,
        match_service: MatchService,
        riot_client: RiotAPIClient,
        rate_limiter: DBRateLimiter,
    ) -> None:
        """Process each tracked player, converting stop conditions to signals."""
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
            except Exception as error:
                if await self._handle_player_processing_error(db, player, error):
                    break

    async def _process_player(
        self,
        db: AsyncSession,
        player: PlayerResponse,
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
        league_before = await player_service.get_player_league(player.puuid)
        ranked_match_ids: set[str] = set()

        def record_stored_match(queue_id: int, match_id: str) -> None:
            if queue_id == RANKED_SOLO_QUEUE_ID:
                ranked_match_ids.add(match_id)

        try:
            count = await match_service.sync_matches_for_player(
                riot_client,
                player,
                rate_limiter,
                on_failure=record_match_sync_failure,
                on_match_stored=record_stored_match,
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
            player_model.match_synced_at = datetime.now(UTC)
            await db.commit()

        # Update player league (will only insert if league has changed)
        try:
            league_updated, lp_observations = await self._refresh_league_and_lp(
                db,
                player,
                player_model,
                player_service,
                riot_client,
                rate_limiter,
                ranked_match_ids,
                league_before,
            )
            self._record_league_refresh_result(
                player,
                league_updated,
                lp_observations,
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

    async def _refresh_league_and_lp(
        self,
        db: AsyncSession,
        player: PlayerResponse,
        player_model: Player,
        player_service: PlayerService,
        riot_client: RiotAPIClient,
        rate_limiter: DBRateLimiter,
        ranked_match_ids: set[str],
        league_before: PlayerLeague | None,
    ) -> tuple[bool, int]:
        """Close one Match Fetcher observation window and commit its evidence."""
        can_proceed = await rate_limiter.acquire()
        if not can_proceed:
            raise RateLimitSignal(
                message="Local rate limiter capacity unavailable during league update"
            )
        league_updated = await player_service.update_player_league(
            player_model, riot_client
        )
        if league_updated:
            await db.flush()
        league_after = await player_service.get_player_league(player.puuid)
        lp_observations = await persist_match_lp_observations(
            db,
            player.puuid,
            ranked_match_ids,
            league_before,
            league_after,
        )
        player_model.league_synced_at = datetime.now(UTC)
        await db.commit()
        await rate_limiter.record_request()
        return league_updated, lp_observations

    def _record_league_refresh_result(
        self,
        player: PlayerResponse,
        league_updated: bool,
        lp_observations: int,
    ) -> None:
        """Record metrics and reviewed identifiers for a completed observation."""
        if league_updated:
            self.metrics["records_updated"] += 1
            logger.info(
                "Player league updated",
                puuid=player.puuid,
                game_name=player.game_name,
            )
        if lp_observations:
            logger.info(
                "Persisted match LP observations",
                puuid=player.puuid,
                observations=lp_observations,
            )
