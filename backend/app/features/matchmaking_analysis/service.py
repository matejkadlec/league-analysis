"""Matchmaking analysis service for analyzing League of Legends matchmaking fairness.

Averages ally against enemy winrates and ranks over the analyzed player's last
N ranked matches; each spine match anchors its participants' samples.
"""

import asyncio
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Any, override

import structlog
from sqlalchemy import (
    ColumnElement,
    Insert,
    and_,
    func,
    insert,
    literal,
    select,
    update,
)
from sqlalchemy.ext.asyncio import AsyncSession
from structlog import contextvars as structlog_contextvars

from app.core.database import db_manager
from app.core.db_session import rollback_quietly
from app.core.enums import Division, Tier
from app.core.riot_api.client import RiotAPIClient
from app.core.riot_api.constants import RANKED_SOLO_QUEUE_ID, RANKED_SOLO_QUEUE_TYPE
from app.core.riot_api.errors import (
    AuthenticationError,
    ForbiddenError,
    RiotAPIError,
)
from app.core.riot_api.models import LeagueEntryDTO, MatchDTO
from app.core.riot_api.scoped_client import tracked_riot_client
from app.core.runs import (
    active_run_filter,
    commit_new_run,
    guarded_run_update,
)
from app.features.jobs.maintenance import ensure_riot_writer_maintenance_is_inactive
from app.features.matches.match_persistence import (
    fully_analyzed_match_ids,
    upsert_match,
)
from app.features.matches.models import Match
from app.features.matches.participants import MatchParticipant
from app.features.players.leagues import (
    PlayerLeague,
    league_snapshot_matches,
    solo_duo_league_entry,
)
from app.features.players.models import Player

from .errors import MatchmakingAnalysisRuntimeError
from .models import MatchmakingAnalysis
from .models import MatchmakingAnalysisResultsJSON as MatchmakingAnalysisResultsJSON
from .ranks import (
    UNRANKED,
    duo_partner_puuids,
    player_rank_map,
    rank_value,
    summarize_ranks,
)
from .rate_limit import MAX_RATE_LIMIT_WAIT as MAX_RATE_LIMIT_WAIT
from .rate_limit import RateLimitRetryMixin
from .schemas import (
    ACTIVE_ANALYSIS_STATUSES,
    MatchmakingAnalysisHistoryItem,
    MatchmakingAnalysisHistoryResponse,
    MatchmakingAnalysisParams,
    MatchmakingAnalysisResponse,
    MatchmakingErrorCode,
)
from .statistics import (
    PlayerPerformance,
    SideSamples,
    SpineMatchStats,
    build_completion_results,
    player_performance_from_rows,
)
from .statistics import side_performance as side_performance
from .statistics import trimmed_mean as trimmed_mean

logger = structlog.get_logger(__name__)

MATCHES_FOR_WINRATE = 10
# Absolute floor, deliberately below the smallest selectable spine size: a
# backdated run that finds only part of its window must still complete.
MIN_MATCHES_FLOOR = 5

# How close a stored league snapshot must sit to the run's reference time to be
# reused: a day for latest runs, two weeks around the day for backdated ones.
RANK_SNAPSHOT_MAX_AGE = timedelta(hours=24)
HISTORICAL_RANK_WINDOW = timedelta(days=14)


def theoretical_max_requests(spine_size: int) -> int:
    """Request maximum with an empty database, as a function of spine size.

    Counts the spine ID list, one match-ID list and the remaining details per
    other player, one detail per spine match, one league-v4 call per player.
    """
    others = spine_size * 9
    return (
        (1 + others)
        + spine_size
        + others * max(1, MATCHES_FOR_WINRATE - 1)
        + (others + 1)
    )


@dataclass(frozen=True)
class RunningAnalysis:
    """Process-local handle for one persisted analysis run."""

    created_at: datetime
    task: asyncio.Task[None]


# Keyed by account and player together: keyed by player alone, a second account
# asking about the same lobby would be handed the first one's run.
_running_analyses: dict[tuple[int, str], RunningAnalysis] = {}


def _team_id_for_player(
    participants: list[tuple[str, int]], analysis_puuid: str
) -> int | None:
    for p_puuid, team_id in participants:
        if p_puuid == analysis_puuid:
            return team_id
    return None


def _untracked_snapshot_insert(p_puuid: str, solo_entry: LeagueEntryDTO) -> Insert:
    """An INSERT whose tracked-player guard the database evaluates at insert
    time -- a Python-side check can go stale before the commit lands."""
    untracked = ~(
        select(Player.puuid)
        .where(Player.puuid == p_puuid, Player.is_tracked_by_anyone)
        .exists()
    )
    return insert(PlayerLeague).from_select(
        ["puuid", "queue_type", "tier", "rank", "league_points", "wins", "losses"],
        select(
            literal(p_puuid),
            literal(solo_entry.queue_type),
            literal(solo_entry.tier.value),
            literal(solo_entry.rank.value),
            literal(solo_entry.league_points),
            literal(solo_entry.wins),
            literal(solo_entry.losses),
        ).where(untracked),
    )


class MatchmakingAnalysisService(RateLimitRetryMixin):
    """Service for analyzing matchmaking fairness.

    Composes `RateLimitRetryMixin`, so every Riot call this service makes runs
    under the shared rate-limit wait/retry policy from `rate_limit.py`.
    """

    @override
    def _active_run_where(
        self, puuid: str, created_at: datetime
    ) -> ColumnElement[bool]:
        """The WHERE clause naming one exact active run of this account's.

        Every cancel/progress/finalize path targets a run by this same triple;
        spelling it once keeps the paths from drifting apart.
        """
        return active_run_filter(
            MatchmakingAnalysis,
            ACTIVE_ANALYSIS_STATUSES,
            self.user_id,
            puuid,
            created_at,
        )

    def _one_run_where(self, puuid: str, created_at: datetime) -> ColumnElement[bool]:
        """The WHERE clause naming one of this account's runs by identity.

        `created_at` is handed out by the status and history endpoints, so it
        identifies a run but proves nothing about who may act on it.
        """
        return and_(
            MatchmakingAnalysis.user_id == self.user_id,
            MatchmakingAnalysis.puuid == puuid,
            MatchmakingAnalysis.created_at == created_at,
        )

    def _completed_run_where(self, puuid: str) -> ColumnElement[bool]:
        """This account's runs for a player that finished and kept results.

        "Completed" without the results check is a lie the history and latest
        endpoints must not tell separately.
        """
        return and_(
            MatchmakingAnalysis.user_id == self.user_id,
            MatchmakingAnalysis.puuid == puuid,
            MatchmakingAnalysis.status == "completed",
            MatchmakingAnalysis.results.isnot(None),
        )

    def __init__(
        self, db: AsyncSession, riot_client: RiotAPIClient | None, user_id: int
    ):
        self.db = db
        # None on the request-scoped instance (see `get_matchmaking_service`):
        # only the background instance ever reaches Riot.
        self.riot_client = riot_client
        # The account this service answers for: every run WHERE clause is keyed
        # on it, not on the player alone.
        self.user_id = user_id
        self.requests_saved: int = 0
        self.api_calls_made: int = 0  # Track actual API calls for savings calculation
        self.matches_analyzed: int = 0
        self._is_waiting_for_rate_limit: bool = False
        self._current_analysis_puuid: str | None = None
        self._current_analysis_created_at: datetime | None = None
        self._winrate_cache: dict[str, float | None] = {}
        # The exact matches each player's winrate counted, so the Recent Form
        # read describes the same sample the figure beside it does.
        self._winrate_sample_ids: dict[str, list[str]] = {}
        self._performance_cache: dict[str, PlayerPerformance | None] = {}
        # Run parameters; the worker re-reads them from the run row so a
        # resumed run keeps the values it was started with.
        self.match_count: int = MatchmakingAnalysisParams().match_count
        self.end_date: date | None = None
        # Rank state, keyed like the winrate cache. `None` in `_rank_values`
        # means unranked or unreadable; the tier bucket then says UNRANKED.
        self._rank_values: dict[str, int | None] = {}
        self._rank_tiers: dict[str, str] = {}
        self._ally_rank_puuids: set[str] = set()
        self._enemy_rank_puuids: set[str] = set()
        self._rank_period_accurate: int = 0
        self._rank_current_day: int = 0

    async def start_analysis(
        self,
        puuid: str,
        params: MatchmakingAnalysisParams | None = None,
    ) -> MatchmakingAnalysisResponse:
        """Create or attach to one active analysis and return immediately.

        On attach the existing run's persisted params win over the request's, so
        the response shows what is actually running.
        """
        await ensure_riot_writer_maintenance_is_inactive(self.db)

        running = _running_analyses.get((self.user_id, puuid))
        if running and running.task.done():
            _running_analyses.pop((self.user_id, puuid), None)

        existing = await self._get_active_analysis(puuid)
        if existing:
            logger.info("Attaching to active analysis", puuid=puuid)
            self._ensure_background_task(puuid, existing.created_at)
            return MatchmakingAnalysisResponse.model_validate(existing)

        now = datetime.now(UTC)
        analysis = MatchmakingAnalysis(
            user_id=self.user_id,
            puuid=puuid,
            created_at=now,
            status="pending",
            puuid_progress={},
            params=(params or MatchmakingAnalysisParams()).model_dump(mode="json"),
        )
        conflict = await commit_new_run(self.db, analysis)
        if conflict is None:
            await self.db.refresh(analysis)
        else:
            existing = await self._get_active_analysis(puuid)
            if not existing:
                # `commit_new_run` returns the IntegrityError rather than
                # raising, so a bare `raise` would have nothing in flight.
                raise conflict
            logger.info("Attached after concurrent start", puuid=puuid)
            self._ensure_background_task(puuid, existing.created_at)
            return MatchmakingAnalysisResponse.model_validate(existing)

        logger.info("Created new matchmaking analysis", puuid=puuid, created_at=now)
        self._ensure_background_task(puuid, now)
        return MatchmakingAnalysisResponse.model_validate(analysis)

    async def cancel_analysis(self, puuid: str, created_at: datetime) -> bool:
        """Cancel the exact active run while retaining its terminal record."""
        result = await self.db.execute(
            select(MatchmakingAnalysis).where(self._active_run_where(puuid, created_at))
        )
        if result.scalar_one_or_none() is None:
            return False

        await self.db.execute(
            update(MatchmakingAnalysis)
            .where(self._active_run_where(puuid, created_at))
            .values(
                status="cancelled",
                completed_at=datetime.now(UTC),
                error_code=None,
                error_message=None,
                rate_limit_reset_at=None,
            )
        )
        await self.db.commit()

        running = _running_analyses.get((self.user_id, puuid))
        if running and running.created_at == created_at and not running.task.done():
            running.task.cancel()
            try:
                await running.task
            except asyncio.CancelledError:
                pass
            except Exception as await_error:
                logger.warning(
                    "matchmaking_analysis_cancel_await_failed",
                    puuid=puuid,
                    error_type=type(await_error).__name__,
                )
        logger.info("Analysis cancelled", puuid=puuid, created_at=created_at)
        return True

    async def get_latest_completed_analysis(
        self, puuid: str
    ) -> MatchmakingAnalysisResponse | None:
        """Get the latest completed analysis for a player (excluding errors)."""
        result = await self.db.execute(
            select(MatchmakingAnalysis)
            .where(self._completed_run_where(puuid))
            .order_by(MatchmakingAnalysis.created_at.desc())
            .limit(1)
        )
        analysis = result.scalar_one_or_none()
        if not analysis:
            return None
        return MatchmakingAnalysisResponse.model_validate(analysis)

    async def get_latest_analysis(
        self, puuid: str
    ) -> MatchmakingAnalysisResponse | None:
        """Get the latest analysis for a player."""
        result = await self.db.execute(
            select(MatchmakingAnalysis)
            .where(
                MatchmakingAnalysis.user_id == self.user_id,
                MatchmakingAnalysis.puuid == puuid,
            )
            .order_by(MatchmakingAnalysis.created_at.desc())
            .limit(1)
        )
        analysis = result.scalar_one_or_none()
        if not analysis:
            return None
        return MatchmakingAnalysisResponse.model_validate(analysis)

    async def get_analysis_status(
        self, puuid: str, created_at: datetime
    ) -> MatchmakingAnalysisResponse | None:
        """Get status of a specific analysis, re-arming one left without a worker."""
        result = await self.db.execute(
            select(MatchmakingAnalysis).where(self._one_run_where(puuid, created_at))
        )
        analysis = result.scalar_one_or_none()
        if not analysis:
            return None

        response = MatchmakingAnalysisResponse.model_validate(analysis)
        if response.status in ACTIVE_ANALYSIS_STATUSES:
            # Shutdown leaves the row active on the contract that a restart
            # resumes it, and this poll is the only caller left to honour it.
            self._ensure_background_task(puuid, created_at)
        return response

    async def get_analysis_history(
        self, puuid: str, limit: int = 20
    ) -> MatchmakingAnalysisHistoryResponse:
        """Get history of completed analyses for a player."""
        result = await self.db.execute(
            select(MatchmakingAnalysis)
            .where(self._completed_run_where(puuid))
            .order_by(MatchmakingAnalysis.created_at.desc())
            .limit(limit)
        )
        analyses = result.scalars().all()
        items: list[MatchmakingAnalysisHistoryItem] = []
        for a in analyses:
            if a.results:
                items.append(
                    MatchmakingAnalysisHistoryItem(
                        created_at=a.created_at,
                        team_avg_winrate=a.results["team_avg_winrate"],
                        enemy_avg_winrate=a.results["enemy_avg_winrate"],
                        params=MatchmakingAnalysisParams.model_validate(a.params or {}),
                    )
                )
        return MatchmakingAnalysisHistoryResponse(items=items)

    async def delete_analysis(self, puuid: str, created_at: datetime) -> bool:
        """Delete a specific completed analysis record by puuid and created_at."""
        result = await self.db.execute(
            select(MatchmakingAnalysis).where(
                self._one_run_where(puuid, created_at),
                MatchmakingAnalysis.status == "completed",
            )
        )
        analysis = result.scalar_one_or_none()
        if not analysis:
            return False
        await self.db.delete(analysis)
        await self.db.commit()
        logger.info("analysis_deleted", puuid=puuid, created_at=str(created_at))
        return True

    async def _get_active_analysis(self, puuid: str) -> MatchmakingAnalysis | None:
        """Return the one persisted active analysis for a player, if present."""
        result = await self.db.execute(
            select(MatchmakingAnalysis)
            .where(
                MatchmakingAnalysis.user_id == self.user_id,
                MatchmakingAnalysis.puuid == puuid,
                MatchmakingAnalysis.status.in_(ACTIVE_ANALYSIS_STATUSES),
            )
            .order_by(MatchmakingAnalysis.created_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    def _ensure_background_task(self, puuid: str, created_at: datetime) -> None:
        """Start the process-local worker once for the persisted active run."""
        running = _running_analyses.get((self.user_id, puuid))
        if running and running.created_at == created_at and not running.task.done():
            return

        task = asyncio.create_task(self._run_analysis_background(puuid, created_at))
        _running_analyses[(self.user_id, puuid)] = RunningAnalysis(
            created_at=created_at,
            task=task,
        )

    async def _run_analysis_background(self, puuid: str, created_at: datetime) -> None:
        """Run analysis in background with its own DB session."""
        # Every log line below this point — the whole run, several call layers
        # deep — carries the run's identity without being handed it.
        structlog_contextvars.bind_contextvars(puuid=puuid, created_at=created_at)
        try:
            async with (
                db_manager.get_session() as db,
                tracked_riot_client(db) as riot_client,
            ):
                service = MatchmakingAnalysisService(db, riot_client, self.user_id)
                await service._run_analysis(puuid, created_at)
        except asyncio.CancelledError:
            # Deliberately leaves the persisted row active: this also fires on
            # process shutdown, and a restart is contracted to resume it.
            logger.info("Background analysis task cancelled; persisted run left active")
            raise
        except Exception as e:
            logger.error(
                "Background analysis failed",
                error_type=type(e).__name__,
                exc_info=True,
            )
            error_code, error_message = self._safe_failure_details(e)
            try:
                async with db_manager.get_session() as db:
                    await ensure_riot_writer_maintenance_is_inactive(db)
                    await db.execute(
                        update(MatchmakingAnalysis)
                        .where(self._active_run_where(puuid, created_at))
                        .values(
                            status="failed",
                            rate_limit_reset_at=None,
                            completed_at=datetime.now(UTC),
                            error_code=error_code,
                            error_message=error_message,
                        )
                    )
                    await db.commit()
            except Exception as persist_error:
                logger.error(
                    "matchmaking_failure_state_persist_failed",
                    error_code=error_code,
                    error_type=type(persist_error).__name__,
                )
        finally:
            running = _running_analyses.get((self.user_id, puuid))
            if running and running.task is asyncio.current_task():
                _running_analyses.pop((self.user_id, puuid), None)
            structlog_contextvars.clear_contextvars()

    @staticmethod
    def _safe_failure_details(error: Exception) -> tuple[MatchmakingErrorCode, str]:
        """Map internal failures to stable, non-technical client messages."""
        if isinstance(error, (AuthenticationError, ForbiddenError)):
            return (
                "RIOT_API_KEY_INVALID",
                "The Riot API key is invalid or expired. Please update it and try "
                "again.",
            )
        if isinstance(error, RiotAPIError):
            return (
                "riot_service_error",
                "Riot data could not be loaded for this analysis. Please try again.",
            )
        if isinstance(error, MatchmakingAnalysisRuntimeError):
            return error.code, error.client_message
        return (
            "analysis_failed",
            "The analysis did not finish. Please try again.",
        )

    async def _run_analysis(self, puuid: str, created_at: datetime) -> None:
        """Core analysis logic.

        Each spine match anchors the winrate lookups for all 10 of its
        participants to that match's own timestamp.
        """
        logger.info("Starting matchmaking analysis")
        self._reset_run_state(puuid, created_at)
        await self._load_run_params(puuid, created_at)
        await self._mark_analysis_in_progress(puuid, created_at)

        try:
            spine_match_ids = await self._load_spine_match_ids(puuid, created_at)
            if spine_match_ids is None:
                return
            if not await self._ensure_spine_matches_ready(
                puuid, created_at, spine_match_ids
            ):
                return
            await self._initialize_progress_keys(puuid, created_at, spine_match_ids)
            spine_stats = await self._collect_match_averages(
                puuid, created_at, spine_match_ids
            )
            await self._finalize_completed_analysis(
                puuid, created_at, spine_stats, spine_size=len(spine_match_ids)
            )
        except Exception as e:
            logger.error("Analysis failed", error_type=type(e).__name__, exc_info=True)
            raise

    def _reset_run_state(self, puuid: str, created_at: datetime) -> None:
        self.requests_saved = 0
        self.api_calls_made = 0
        self.matches_analyzed = 0
        self._current_analysis_puuid = puuid
        self._current_analysis_created_at = created_at
        self._winrate_cache = {}
        self._winrate_sample_ids = {}
        self._performance_cache = {}
        self._rank_values = {}
        self._rank_tiers = {}
        self._ally_rank_puuids = set()
        self._enemy_rank_puuids = set()
        self._rank_period_accurate = 0
        self._rank_current_day = 0

    async def _load_run_params(self, puuid: str, created_at: datetime) -> None:
        """Read the run's persisted params; a resumed worker has no request."""
        analysis = await self._get_analysis(puuid, created_at)
        params = MatchmakingAnalysisParams.model_validate(analysis.params or {})
        self.match_count = params.match_count
        self.end_date = params.end_date

    @property
    def _spine_end_time_seconds(self) -> int | None:
        """match-v5 `endTime` for the chosen day: exclusive next midnight UTC."""
        if self.end_date is None:
            return None
        next_midnight = datetime.combine(
            self.end_date + timedelta(days=1), time.min, tzinfo=UTC
        )
        return int(next_midnight.timestamp())

    @property
    def _rank_reference_time(self) -> datetime:
        """The moment participant ranks should describe."""
        if self.end_date is None:
            return datetime.now(UTC)
        return datetime.combine(self.end_date, time.max, tzinfo=UTC)

    @override
    async def _write_active_run(
        self, puuid: str, created_at: datetime, **values: Any
    ) -> None:
        """Guarded UPDATE of one active run, committed.

        Deliberately not used by `cancel_analysis`, which omits the maintenance
        check, nor by `_finalize_completed_analysis`, which reads status back.
        """
        await ensure_riot_writer_maintenance_is_inactive(self.db)
        await guarded_run_update(
            self.db,
            MatchmakingAnalysis,
            ACTIVE_ANALYSIS_STATUSES,
            self.user_id,
            puuid,
            created_at,
            **values,
        )

    async def _mark_analysis_in_progress(
        self, puuid: str, created_at: datetime
    ) -> None:
        await self._write_active_run(
            puuid,
            created_at,
            status="in_progress",
            started_at=func.coalesce(
                MatchmakingAnalysis.started_at,
                datetime.now(UTC),
            ),
            error_code=None,
            error_message=None,
        )

    async def _load_spine_match_ids(
        self, puuid: str, created_at: datetime
    ) -> list[str] | None:
        # This call cannot be skipped: without an end date it has no endTime and
        # returns the latest matches; with one, endTime bounds the spine.
        spine_match_ids = await self._api_fetch_match_ids(
            puuid,
            count=self.match_count,
            end_time=self._spine_end_time_seconds,
            required=True,
        )
        found = len(spine_match_ids) if spine_match_ids else 0
        if found < MIN_MATCHES_FLOOR:
            await self._complete_with_error(
                puuid,
                created_at,
                "Player doesn't have enough ranked matches for this analysis. "
                f"Found {found}, "
                f"need at least {MIN_MATCHES_FLOOR}.",
                error_code="not_enough_matches",
            )
            return None
        return spine_match_ids

    async def _ensure_spine_matches_ready(
        self, puuid: str, created_at: datetime, spine_match_ids: list[str]
    ) -> bool:
        # One batch read answers "already fully analyzed" for the whole
        # spine; only the misses cost a rate-limited API fetch.
        already_analyzed = await fully_analyzed_match_ids(self.db, spine_match_ids)
        spine_in_db_count = len(already_analyzed)
        for mid in spine_match_ids:
            if mid in already_analyzed:
                continue
            dto = await self._api_fetch_match(mid)
            if dto:
                await self._store_fetched_match(dto)

        first_participants = await self._get_match_participants(spine_match_ids[0])
        if not any(p == puuid for p, _ in first_participants):
            await self._complete_with_error(
                puuid,
                created_at,
                "The selected player could not be verified in the latest matches.",
                error_code="player_not_in_match",
            )
            return False

        logger.info(
            "Spine matches ready",
            count=len(spine_match_ids),
            in_db=spine_in_db_count,
        )
        return True

    async def _initialize_progress_keys(
        self, puuid: str, created_at: datetime, spine_match_ids: list[str]
    ) -> None:
        all_keys: list[str] = []
        for mid in spine_match_ids:
            participants = await self._get_match_participants(mid)
            for p_puuid, _ in participants:
                all_keys.append(f"{p_puuid}:{mid}")

        existing_analysis = await self._get_analysis(puuid, created_at)
        existing_progress = existing_analysis.puuid_progress or {}
        initial_progress = {
            key: bool(existing_progress.get(key, False)) for key in all_keys
        }
        await self._update_progress(puuid, created_at, initial_progress)
        logger.info("Progress initialized", total_keys=len(all_keys))

    async def _collect_match_averages(
        self, puuid: str, created_at: datetime, spine_match_ids: list[str]
    ) -> list[SpineMatchStats]:
        spine_stats: list[SpineMatchStats] = []

        for idx, match_id in enumerate(spine_match_ids):
            match_anchor = await self._get_game_start_timestamp(match_id)
            if match_anchor is None:
                logger.warning(
                    "matchmaking_anchor_timestamp_missing", match_id=match_id
                )
                continue

            match_anchor_seconds = match_anchor // 1000 + 1
            logger.info(
                "matchmaking_processing_match",
                match_index=idx + 1,
                match_total=len(spine_match_ids),
                match_id=match_id,
                anchor=match_anchor,
            )
            result = await self._sample_spine_match(
                puuid, created_at, match_id, match_anchor_seconds
            )
            if result:
                spine_stats.append(result)

        return spine_stats

    async def _finalize_completed_analysis(
        self,
        puuid: str,
        created_at: datetime,
        spine_stats: list[SpineMatchStats],
        *,
        spine_size: int,
    ) -> None:
        # Excludes the players matchmaking never chose (the analyzed player and
        # duo partners), who still stay in `player_ranks` for the lobby-gap line.
        excluded_allies = duo_partner_puuids(
            [(s.match_id, s.ally_puuids) for s in spine_stats],
            analyzed_puuid=puuid,
        ) | {puuid}
        results = build_completion_results(
            spine_stats,
            matches_analyzed=self.matches_analyzed,
            matches_requested=self.match_count,
            rank_summary=summarize_ranks(
                self._ally_rank_puuids - excluded_allies,
                self._enemy_rank_puuids,
                self._rank_tiers,
                self._rank_values,
            ),
            player_ranks=player_rank_map(
                self._ally_rank_puuids | self._enemy_rank_puuids,
                self._rank_tiers,
                self._rank_values,
            ),
            rank_period_accurate=self._rank_period_accurate,
            rank_current_day=self._rank_current_day,
            analyzed_puuid=puuid,
        )
        self.requests_saved = max(
            theoretical_max_requests(spine_size) - self.api_calls_made, 0
        )
        now = datetime.now(UTC)
        await ensure_riot_writer_maintenance_is_inactive(self.db)
        await self.db.execute(
            update(MatchmakingAnalysis)
            .where(self._active_run_where(puuid, created_at))
            .values(
                status="completed",
                results=results,
                completed_at=now,
                error_code=None,
                error_message=None,
                requests_saved=self.requests_saved,
                rate_limit_reset_at=None,
            )
        )

        completion_status = await self.db.execute(
            select(MatchmakingAnalysis.status).where(
                self._one_run_where(puuid, created_at)
            )
        )
        if completion_status.scalar_one_or_none() != "completed":
            await rollback_quietly(self.db)
            logger.info("Analysis completion ignored after terminal state")
            return

        await self.db.execute(
            update(Player)
            .where(Player.puuid == puuid)
            .values(last_matchmaking_analysis=now)
        )
        await self.db.commit()

        logger.info(
            "Analysis completed",
            results=results,
            requests_saved=self.requests_saved,
        )

    async def _sample_spine_match(
        self,
        analysis_puuid: str,
        analysis_created_at: datetime,
        match_id: str,
        end_time_seconds: int,
    ) -> SpineMatchStats | None:
        """Process a single spine match: winrates and ranks for all participants."""
        participants = await self._get_match_participants(match_id)
        if not participants:
            return None

        target_team = _team_id_for_player(participants, analysis_puuid)
        if target_team is None:
            logger.warning("Current player not in match", match_id=match_id)
            return None

        team, enemy = SideSamples({}, {}), SideSamples({}, {})
        ally_puuids: list[str] = []
        enemy_puuids: list[str] = []

        for p_puuid, team_id in participants:
            # Everyone is sampled; the analyzed player and the duo partners are
            # excluded later, once the whole spine is known.
            side = team if team_id == target_team else enemy
            await self._sample_participant(
                side, p_puuid, end_time_seconds, analysis_puuid, analysis_created_at
            )
            if team_id == target_team:
                self._ally_rank_puuids.add(p_puuid)
                ally_puuids.append(p_puuid)
            else:
                self._enemy_rank_puuids.add(p_puuid)
                enemy_puuids.append(p_puuid)

        return SpineMatchStats(
            match_id=match_id,
            ally_puuids=ally_puuids,
            enemy_puuids=enemy_puuids,
            # DB-only by now: the participants query above stored the match.
            win=await self._get_win_status(match_id, analysis_puuid),
            ally_winrates=team.winrates,
            enemy_winrates=enemy.winrates,
            ally_performances=team.performances,
            enemy_performances=enemy.performances,
        )

    async def _sample_participant(
        self,
        side: SideSamples,
        p_puuid: str,
        end_time_seconds: int,
        analysis_puuid: str,
        analysis_created_at: datetime,
    ) -> None:
        """One participant's winrate, trailing form and rank, onto their side."""
        wr = await self._cached_player_winrate(
            p_puuid, end_time_seconds, analysis_puuid, analysis_created_at
        )
        if wr is not None:
            side.winrates[p_puuid] = wr
        # After the winrate above, so the sampled match IDs it recorded exist.
        perf = await self._cached_player_performance(p_puuid)
        if perf is not None:
            side.performances[p_puuid] = perf
        await self._cached_player_rank(p_puuid)

    async def _cached_player_winrate(
        self,
        p_puuid: str,
        end_time_seconds: int,
        analysis_puuid: str,
        analysis_created_at: datetime,
    ) -> float | None:
        if p_puuid in self._winrate_cache:
            return self._winrate_cache[p_puuid]
        wr = await self._calculate_player_winrate(p_puuid, end_time_seconds)
        self._winrate_cache[p_puuid] = wr
        await self._mark_player_progress(analysis_puuid, analysis_created_at, p_puuid)
        return wr

    async def _cached_player_performance(
        self, p_puuid: str
    ) -> PlayerPerformance | None:
        """One player's form over exactly the matches their winrate counted.

        Every match in `_winrate_sample_ids` had a readable participant row, so
        this read is DB-only and cannot describe a different window.
        """
        if p_puuid in self._performance_cache:
            return self._performance_cache[p_puuid]

        sample_ids = self._winrate_sample_ids.get(p_puuid)
        if not sample_ids:
            self._performance_cache[p_puuid] = None
            return None
        result = await self.db.execute(
            select(
                MatchParticipant.kda,
                MatchParticipant.kill_participation,
                MatchParticipant.team_damage_percentage,
            ).where(
                MatchParticipant.puuid == p_puuid,
                MatchParticipant.match_id.in_(sample_ids),
            )
        )
        perf = player_performance_from_rows(result.tuples().all())
        self._performance_cache[p_puuid] = perf
        return perf

    async def _mark_player_progress(
        self,
        analysis_puuid: str,
        analysis_created_at: datetime,
        p_puuid: str,
    ) -> None:
        analysis = await self._get_analysis(analysis_puuid, analysis_created_at)
        progress = analysis.puuid_progress or {}
        for key in list(progress.keys()):
            if key.startswith(f"{p_puuid}:"):
                progress[key] = True
        await self._update_progress(analysis_puuid, analysis_created_at, progress)

    async def _cached_player_rank(self, p_puuid: str) -> None:
        """Resolve one participant's Solo/Duo rank once per run.

        Snapshot-first: a `player_leagues` row near the run's reference time is
        reused without an API call. A failed read is UNRANKED; auth errors re-raise.
        """
        if p_puuid in self._rank_values:
            return

        snapshot = await self._find_rank_snapshot(p_puuid)
        if snapshot is not None:
            self._record_rank(
                p_puuid,
                snapshot.tier,
                snapshot.rank,
                snapshot.league_points,
                period_accurate=True,
            )
            return

        entries = await self._api_call_with_retries(
            lambda: self._riot.get_league_entries_by_puuid(p_puuid),
            required=False,
            operation="league entry fetch",
            target_puuid=p_puuid,
        )
        solo_entry = solo_duo_league_entry(entries) if entries is not None else None
        if solo_entry is None:
            self._rank_values[p_puuid] = None
            self._rank_tiers[p_puuid] = UNRANKED
            return

        self._record_rank(
            p_puuid,
            solo_entry.tier,
            solo_entry.rank,
            solo_entry.league_points,
            period_accurate=self._live_read_is_period_accurate(),
        )
        await self._store_rank_snapshot(p_puuid, solo_entry)

    def _live_read_is_period_accurate(self) -> bool:
        """Judge a live read the way `_find_rank_snapshot` judges its stored
        snapshot, so an identical rerun reports the same freshness caption
        instead of flipping current-day counts to period-accurate ones."""
        if self.end_date is None:
            return True
        now = datetime.now(UTC)
        return abs(now - self._rank_reference_time) <= HISTORICAL_RANK_WINDOW

    def _record_rank(
        self,
        p_puuid: str,
        tier: str | Tier,
        rank: str | Division | None,
        league_points: int,
        *,
        period_accurate: bool,
    ) -> None:
        tier_value = tier.value if isinstance(tier, Tier) else tier
        rank_value_arg = rank.value if isinstance(rank, Division) else rank
        self._rank_values[p_puuid] = rank_value(
            tier_value, rank_value_arg, league_points
        )
        self._rank_tiers[p_puuid] = tier_value
        if period_accurate:
            self._rank_period_accurate += 1
        else:
            self._rank_current_day += 1

    async def _find_rank_snapshot(self, p_puuid: str) -> PlayerLeague | None:
        """The stored snapshot nearest the run's reference time, if fresh enough."""
        reference = self._rank_reference_time
        if self.end_date is None:
            window_start, window_end = reference - RANK_SNAPSHOT_MAX_AGE, reference
        else:
            window_start = reference - HISTORICAL_RANK_WINDOW
            window_end = reference + HISTORICAL_RANK_WINDOW
        distance = func.abs(
            func.extract("epoch", PlayerLeague.created_at) - reference.timestamp()
        )
        result = await self.db.execute(
            select(PlayerLeague)
            .where(
                PlayerLeague.puuid == p_puuid,
                PlayerLeague.queue_type == RANKED_SOLO_QUEUE_TYPE,
                PlayerLeague.created_at >= window_start,
                PlayerLeague.created_at <= window_end,
            )
            .order_by(distance)
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def _store_rank_snapshot(
        self, p_puuid: str, solo_entry: LeagueEntryDTO
    ) -> None:
        """Persist a live league read as a snapshot for future runs.

        Tracked players are skipped: an analysis-time snapshot inside Match
        Fetcher's before/after window downgrades LP attribution.
        """
        tracked = await self.db.execute(
            select(Player.is_tracked_by_anyone).where(Player.puuid == p_puuid)
        )
        if tracked.scalar_one_or_none():
            return

        latest = await self.db.execute(
            select(PlayerLeague)
            .where(
                PlayerLeague.puuid == p_puuid,
                PlayerLeague.queue_type == RANKED_SOLO_QUEUE_TYPE,
            )
            .order_by(PlayerLeague.created_at.desc())
            .limit(1)
        )
        current = latest.scalar_one_or_none()
        if current is not None and league_snapshot_matches(current, solo_entry):
            return

        await ensure_riot_writer_maintenance_is_inactive(self.db)
        # INSERT-from-SELECT so the tracked check re-evaluates inside the insert:
        # the check above goes stale if tracking starts before the commit.
        await self.db.execute(_untracked_snapshot_insert(p_puuid, solo_entry))
        await self.db.commit()

    async def _calculate_player_winrate(
        self,
        puuid: str,
        end_time_seconds: int,
    ) -> float | None:
        """Calculate a player's winrate from their last 10 ranked matches.

        DB-first: uses the DB when it holds ≥10 fully_analyzed ranked matches
        before the anchor time, otherwise falls back to the API.
        """
        anchor_ms = end_time_seconds * 1000

        result = await self.db.execute(
            select(MatchParticipant.match_id, MatchParticipant.win)
            .join(Match, MatchParticipant.match_id == Match.match_id)
            .where(
                MatchParticipant.puuid == puuid,
                Match.queue_id == RANKED_SOLO_QUEUE_ID,
                Match.game_start_timestamp <= anchor_ms,
                Match.fully_analyzed.is_(True),
            )
            .order_by(Match.game_start_timestamp.desc())
            .limit(MATCHES_FOR_WINRATE)
        )
        db_rows = result.tuples().all()

        if len(db_rows) >= MATCHES_FOR_WINRATE:
            return self._winrate_from_rows(puuid, db_rows)

        match_ids = await self._get_match_ids_for_player(puuid, end_time_seconds)
        if not match_ids:
            return self._winrate_from_rows(puuid, db_rows)
        return await self._winrate_from_match_ids(match_ids, puuid)

    def _winrate_from_rows(
        self, puuid: str, rows: Sequence[tuple[str, bool]]
    ) -> float | None:
        if not rows:
            return None
        self.matches_analyzed += len(rows)
        self._winrate_sample_ids[puuid] = [match_id for match_id, _ in rows]
        return sum(win for _, win in rows) / len(rows)

    async def _winrate_from_match_ids(
        self, match_ids: list[str], puuid: str
    ) -> float | None:
        wins = 0
        sampled: list[str] = []
        for mid in match_ids:
            win = await self._get_win_status(mid, puuid)
            if win is not None:
                sampled.append(mid)
                if win:
                    wins += 1
        if not sampled:
            return None
        self.matches_analyzed += len(sampled)
        self._winrate_sample_ids[puuid] = sampled
        return wins / len(sampled)

    async def _get_match_participants(self, match_id: str) -> list[tuple[str, int]]:
        """Get (puuid, team_id) for all participants. DB-first."""
        result = await self.db.execute(
            select(MatchParticipant.puuid, MatchParticipant.team_id).where(
                MatchParticipant.match_id == match_id
            )
        )
        rows = result.all()
        if rows:
            return [(r.puuid, r.team_id) for r in rows]

        dto = await self._api_fetch_match(match_id, required=True)
        if dto is None:
            return []
        await self._store_fetched_match(dto)
        return [(p.puuid, p.team_id) for p in dto.info.participants]

    async def _get_win_status(self, match_id: str, puuid: str) -> bool | None:
        """Get win status for a player in a match. DB-first."""
        result = await self.db.execute(
            select(MatchParticipant.win).where(
                MatchParticipant.match_id == match_id,
                MatchParticipant.puuid == puuid,
            )
        )
        win = result.scalar_one_or_none()
        if win is not None:
            return win

        dto = await self._api_fetch_match(match_id)
        if dto is None:
            return None
        await self._store_fetched_match(dto)

        result = await self.db.execute(
            select(MatchParticipant.win).where(
                MatchParticipant.match_id == match_id,
                MatchParticipant.puuid == puuid,
            )
        )
        return result.scalar_one_or_none()

    async def _store_fetched_match(self, match_dto: MatchDTO) -> None:
        """Persist an API-fetched match only while cleanup is inactive."""
        await ensure_riot_writer_maintenance_is_inactive(self.db)
        await upsert_match(self.db, match_dto)

    async def _get_game_start_timestamp(self, match_id: str) -> int | None:
        """Get game_start_timestamp for a match from DB."""
        result = await self.db.execute(
            select(Match.game_start_timestamp).where(Match.match_id == match_id)
        )
        return result.scalar_one_or_none()

    async def _get_match_ids_for_player(
        self,
        puuid: str,
        end_time_seconds: int,
    ) -> list[str]:
        """Get a player's ranked match IDs with endTime from API."""
        return await self._api_fetch_match_ids(
            puuid,
            count=MATCHES_FOR_WINRATE,
            end_time=end_time_seconds,
        )

    @property
    def _riot(self) -> RiotAPIClient:
        """The Riot client, which only the background instance carries."""
        if self.riot_client is None:
            raise AuthenticationError(
                "Riot API calls are not available on the request-scoped service"
            )
        return self.riot_client

    async def _api_fetch_match_ids(
        self,
        puuid: str,
        count: int = 10,
        end_time: int | None = None,
        *,
        required: bool = False,
    ) -> list[str]:
        """Fetch match IDs from Riot API with rate limit handling."""
        match_list = await self._api_call_with_retries(
            lambda: self._riot.get_match_list_by_puuid(
                puuid=puuid,
                start=0,
                count=count,
                queue=RANKED_SOLO_QUEUE_ID,
                end_time=end_time,
            ),
            required=required,
            operation="match ID fetch",
            # Not the analysis subject bound in contextvars — this is whichever
            # participant's history is being fetched right now.
            target_puuid=puuid,
        )
        return match_list.match_ids if match_list else []

    async def _api_fetch_match(
        self, match_id: str, *, required: bool = False
    ) -> MatchDTO | None:
        """Fetch a single match from API. Returns MatchDTO or None."""
        return await self._api_call_with_retries(
            lambda: self._riot.get_match(match_id),
            required=required,
            operation="match fetch",
            match_id=match_id,
        )

    async def _get_analysis(
        self, puuid: str, created_at: datetime
    ) -> MatchmakingAnalysis:
        result = await self.db.execute(
            select(MatchmakingAnalysis).where(self._active_run_where(puuid, created_at))
        )
        return result.scalar_one()

    async def _update_progress(
        self, puuid: str, created_at: datetime, progress: dict[str, bool]
    ) -> None:
        await self._write_active_run(puuid, created_at, puuid_progress=progress)

    async def _complete_with_error(
        self,
        puuid: str,
        created_at: datetime,
        msg: str,
        *,
        error_code: str,
    ) -> None:
        logger.warning("Analysis ended without results", code=error_code)
        await self._write_active_run(
            puuid,
            created_at,
            status="failed",
            completed_at=datetime.now(UTC),
            results=None,
            error_code=error_code,
            error_message=msg,
            rate_limit_reset_at=None,
        )
