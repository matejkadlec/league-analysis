from datetime import UTC, datetime
from typing import override

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.riot_api.client import RiotAPIClient
from app.core.riot_api.constants import (
    PRODUCT_SUPPORTED_QUEUE_IDS,
    RANKED_SOLO_QUEUE_ID,
)
from app.core.riot_api.errors import RateLimitError
from app.features.jobs.base import BaseJob, JobStopSignal
from app.features.jobs.error_handling import (
    RateLimitSignal,
)
from app.features.jobs.maintenance import RiotWriterMaintenanceActiveError
from app.features.matches.match_lp import persist_match_lp_observations
from app.features.matches.service import MatchService
from app.features.players.leagues import PlayerLeague
from app.features.players.models import Player
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

        supported_queue_ids = list(PRODUCT_SUPPORTED_QUEUE_IDS)
        self.add_log_entry("supported_queue_ids", supported_queue_ids)

        player_service = PlayerService(db)
        match_service = MatchService(db)

        async with self.job_riot_client(db) as riot_client:
            tracked_puuids = await self._load_tracked_puuids(db)
            logger.info("Starting match fetcher job", tracked_count=len(tracked_puuids))
            await self._process_tracked_players(
                db,
                tracked_puuids,
                player_service,
                match_service,
                riot_client,
            )

    async def _handle_player_processing_error(
        self,
        db: AsyncSession,
        puuid: str,
        error: Exception,
    ) -> bool:
        """Record a recoverable player error. Return True to stop the job."""
        return await self.handle_player_error(
            db,
            error,
            message="Error processing player",
            operation="player synchronization",
            puuid=puuid,
        )

    async def _process_tracked_players(
        self,
        db: AsyncSession,
        tracked_puuids: list[str],
        player_service: PlayerService,
        match_service: MatchService,
        riot_client: RiotAPIClient,
    ) -> None:
        """Process each tracked player, converting stop conditions to signals."""
        for puuid in tracked_puuids:
            await self.check_control_state(db)
            try:
                # Re-read per iteration: `_handle_player_processing_error`
                # rolls the session back, which expires every row it holds.
                player = await db.get(Player, puuid)
                if player is None:
                    logger.warning("Tracked player is gone", puuid=puuid)
                    continue
                await self._process_player(
                    db,
                    player,
                    player_service,
                    match_service,
                    riot_client,
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
                if await self._handle_player_processing_error(db, puuid, error):
                    break

    async def _process_player(
        self,
        db: AsyncSession,
        player: Player,
        player_service: PlayerService,
        match_service: MatchService,
        riot_client: RiotAPIClient,
    ) -> None:
        """Fetch and sync matches for a single player, then update their league.

        Note: Player profile updates (game_name, tag_line, profile_icon_id, summoner_level)
        are handled by the separate PlayerUpdaterJob which runs less frequently (every 24h).
        """

        # The identifier, not the row: this closure runs after a skipped match
        # has rolled the session back, and a rolled-back session expires every
        # instance it holds. Reading `player.puuid` there raises instead of
        # reporting the match that failed.
        puuid = player.puuid

        # Fetch new matches with rate limiting
        def record_match_sync_failure(
            operation: str,
            error: Exception,
            context: dict[str, object],
        ) -> None:
            self.record_error(
                error,
                operation=operation,
                context={"puuid": puuid, **context},
            )

        error_count_before = len(self._errors_encountered)
        league_before = await player_service.get_player_league(puuid)
        ranked_match_ids: set[str] = set()

        def record_stored_match(queue_id: int, match_id: str) -> None:
            if queue_id == RANKED_SOLO_QUEUE_ID:
                ranked_match_ids.add(match_id)

        try:
            count = await match_service.sync_matches_for_player(
                riot_client,
                player,
                on_failure=record_match_sync_failure,
                on_match_stored=record_stored_match,
            )
        except RateLimitError as error:
            raise RateLimitSignal(
                retry_after=error.retry_after,
                message="Rate limit reached while synchronizing matches",
            ) from error
        self.metrics["records_created"] += count

        if len(self._errors_encountered) != error_count_before:
            # Same rollback, other half of the problem: everything below reads
            # `player` synchronously, and an expired read outside an await
            # raises `MissingGreenlet`, which `is_database_job_error` then
            # calls fatal. One SELECT per failing player buys the row back.
            await db.refresh(player)

        if len(self._errors_encountered) == error_count_before:
            player.match_synced_at = datetime.now(UTC)
            await db.commit()

        # Update player league (will only insert if league has changed)
        try:
            league_updated, lp_observations = await self._refresh_league_and_lp(
                db,
                player,
                player_service,
                riot_client,
                ranked_match_ids,
                league_before,
            )
            self._record_league_refresh_result(
                player,
                league_updated,
                lp_observations,
            )
        except RateLimitError:
            raise
        except Exception as e:
            # This one re-raises rather than returning, because its caller is
            # `_process_player`, which has no stop channel of its own: the
            # exception is how the decision reaches the loop, via
            # `_handle_player_processing_error`.
            if await self.handle_player_error(
                db,
                e,
                message="Error updating player league",
                operation="player league update",
                puuid=player.puuid,
            ):
                raise

    async def _refresh_league_and_lp(
        self,
        db: AsyncSession,
        player: Player,
        player_service: PlayerService,
        riot_client: RiotAPIClient,
        ranked_match_ids: set[str],
        league_before: PlayerLeague | None,
    ) -> tuple[bool, int]:
        """Close one Match Fetcher observation window and commit its evidence."""
        league_updated = await player_service.update_player_league(player, riot_client)
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
        player.league_synced_at = datetime.now(UTC)
        await db.commit()
        return league_updated, lp_observations

    def _record_league_refresh_result(
        self,
        player: Player,
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
