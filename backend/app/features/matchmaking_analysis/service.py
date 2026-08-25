"""Matchmaking analysis service for analyzing League of Legends matchmaking fairness.

Calculates avg winrate of allies vs enemies across the current player's last 10
ranked matches. For each of the ~91 unique players in those matches, fetches their
last 10 ranked matches (at the time the match with current player was played) to
calculate their individual winrate.

Analysis Flow:
1. Fetch current player's last 10 ranked match IDs from API (no endTime — actual latest)
2. For each spine match (10 total):
   a. Use THIS match's game_start_timestamp as the anchor for this match
   b. Get all 10 participants in this match
   c. For each participant, get their last 10 ranked matches with endTime=anchor
   d. Calculate each participant's winrate from those matches
   e. Average team winrates and enemy winrates for this match
3. Final: average of the 10 per-match team/enemy averages

Key: Each match has its own anchor timestamp, ensuring historical accuracy

DB-First Strategy:
- Check DB for match data (fully_analyzed=true) before calling Riot API
- Every match fetched from API is stored in DB for future use
- This can save hundreds of API calls if matches are already in DB

Rate Limiting:
- The Riot client's own limiter waits out the windows it reads from Riot's
  rate-limit response headers; a 429 that still lands is caught here
- When rate limited, persists rate_limit_reset_at for lifecycle diagnostics
- Waits and retries automatically (up to 30 minutes total)
"""

import asyncio
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from statistics import fmean
from typing import Any

import structlog
from sqlalchemy import ColumnElement, and_, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from structlog import contextvars as structlog_contextvars

from app.core.database import db_manager
from app.core.db_session import rollback_quietly
from app.core.riot_api.client import RiotAPIClient
from app.core.riot_api.constants import RANKED_SOLO_QUEUE_ID
from app.core.riot_api.errors import (
    AuthenticationError,
    ForbiddenError,
    RateLimitError,
    RiotAPIError,
)
from app.core.riot_api.models import MatchDTO
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
from app.features.players.models import Player

from .models import MatchmakingAnalysis, MatchmakingAnalysisResultsJSON
from .schemas import (
    ACTIVE_ANALYSIS_STATUSES,
    MatchmakingAnalysisHistoryItem,
    MatchmakingAnalysisHistoryResponse,
    MatchmakingAnalysisResponse,
)

logger = structlog.get_logger(__name__)

MAX_RATE_LIMIT_WAIT = 120

MATCHES_TO_ANALYZE = 10
MATCHES_FOR_WINRATE = 10
MIN_MATCHES_REQUIRED = 10

# Theoretical request maximum with an empty database: 1 call for the current
# player's spine IDs, one match-ID list per other player, one match detail per
# spine match, and each other player's remaining match details (1 of each
# player's matches is the already-known spine match).
_OTHER_PLAYERS = MATCHES_TO_ANALYZE * 9
THEORETICAL_MAX_REQUESTS = (
    (1 + _OTHER_PLAYERS)
    + MATCHES_TO_ANALYZE
    + _OTHER_PLAYERS * max(1, MATCHES_FOR_WINRATE - 1)
)


# The retry policy `_api_call_with_retries` runs under, as plain rules --
# none of it reads run state, like the completion math above it.


def _rate_limit_retry_after(error: RateLimitError) -> int:
    return int(error.retry_after or 120)


def _should_reraise_riot_error(error: RiotAPIError, *, required: bool) -> bool:
    return isinstance(error, (AuthenticationError, ForbiddenError)) or required


def _raise_if_retries_exhausted(*, required: bool) -> None:
    if required:
        raise MatchmakingAnalysisRuntimeError(
            "rate_limit_wait_exhausted",
            "The analysis could not resume within the allowed Riot rate-limit "
            "wait. Please try again later.",
        )


@dataclass(frozen=True)
class RunningAnalysis:
    """Process-local handle for one persisted analysis run."""

    created_at: datetime
    task: asyncio.Task[None]


# Keyed by account and player together. Keyed by player alone, one account's
# worker was the only worker that could exist for a lobby, so a second account
# asking was silently handed the first one's run.
_running_analyses: dict[tuple[int, str], RunningAnalysis] = {}


class MatchmakingAnalysisRuntimeError(Exception):
    """Internal failure carrying only reviewed client-safe diagnostics."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(code)
        self.code = code
        self.client_message = message


# The pure completion model. Everything below is arithmetic over already
# fetched winrates -- no session, no client, no service state -- so it can be
# read and tested without constructing a `MatchmakingAnalysisService`.


def _team_id_for_player(
    participants: list[tuple[str, int]], analysis_puuid: str
) -> int | None:
    for p_puuid, team_id in participants:
        if p_puuid == analysis_puuid:
            return team_id
    return None


def _build_completion_results(
    team_avgs: list[float],
    enemy_avgs: list[float],
    *,
    matches_analyzed: int,
) -> MatchmakingAnalysisResultsJSON:
    """Summarise a finished run, or refuse to call an empty one finished.

    A run that measured nothing is a failure, not a 0.0%-vs-0.0% verdict:
    `_run_analysis_task` already persists a `failed` row for a raised error.
    `matches_analyzed` is required and measured, not expected -- the UI prints
    it as the basis of the verdict, and a shallow database reaches nothing
    like the theoretical maximum.
    """
    if not team_avgs or not enemy_avgs:
        raise MatchmakingAnalysisRuntimeError(
            "no_matches_analyzed",
            "No ranked match history could be read for this lobby. "
            "Please try again later.",
        )
    return {
        "team_avg_winrate": round(fmean(team_avgs), 4),
        "enemy_avg_winrate": round(fmean(enemy_avgs), 4),
        "matches_analyzed": matches_analyzed,
    }


class MatchmakingAnalysisService:
    """Service for analyzing matchmaking fairness."""

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

    MAX_RATE_LIMIT_ATTEMPTS = 10

    def __init__(
        self, db: AsyncSession, riot_client: RiotAPIClient | None, user_id: int
    ):
        self.db = db
        # None on the request-scoped instance (see `get_matchmaking_service`):
        # only the background instance, built with its own tracked client,
        # ever reaches Riot.
        self.riot_client = riot_client
        # The account this service answers for. See the identical note on
        # `SmurfBoostDetectionService`: these were module-level WHERE helpers
        # keyed on the player alone, which is how cancel and delete came to
        # reach across accounts.
        self.user_id = user_id
        self.requests_saved: int = 0
        self.api_calls_made: int = 0  # Track actual API calls for savings calculation
        self.matches_analyzed: int = 0
        self._is_waiting_for_rate_limit: bool = False
        self._current_analysis_puuid: str | None = None
        self._current_analysis_created_at: datetime | None = None
        self._winrate_cache: dict[str, float | None] = {}

    # ================================================================
    # Public API
    # ================================================================

    async def start_analysis(self, puuid: str) -> MatchmakingAnalysisResponse:
        """Create or attach to one active analysis and return immediately."""
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
        )
        conflict = await commit_new_run(self.db, analysis)
        if conflict is None:
            await self.db.refresh(analysis)
        else:
            existing = await self._get_active_analysis(puuid)
            if not existing:
                # `commit_new_run` returns the IntegrityError rather than raising
                # it, so no exception is in flight here: a bare `raise` reached
                # this line as `RuntimeError: No active exception to reraise`,
                # hiding the constraint that actually failed.
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
        """Get status of a specific analysis."""
        result = await self.db.execute(
            select(MatchmakingAnalysis).where(self._one_run_where(puuid, created_at))
        )
        analysis = result.scalar_one_or_none()
        if not analysis:
            return None

        # The same one-liner its two siblings use. What stood here restated
        # `progress`/`total_puuids` -- both already computed fields on the
        # response -- and re-listed all twelve fields by keyword, including a
        # `requests_saved or 0` for a NOT NULL column.
        return MatchmakingAnalysisResponse.model_validate(analysis)

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

    # ================================================================
    # Background Analysis
    # ================================================================

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
            # Deliberately leaves the persisted row active: this also fires when
            # process shutdown cancels the task, and a restart is contracted to
            # resume with progress intact. Explicit user cancellation is
            # unaffected -- `cancel_analysis` commits the terminal row first.
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
    def _safe_failure_details(error: Exception) -> tuple[str, str]:
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
        """
        Core analysis logic.

        1. Fetch current player's last 10 ranked match IDs (no endTime — actual latest)
        2. Ensure all spine matches are in DB
        3. Pre-populate progress keys
        4. For each spine match:
           - Use that match's timestamp as anchor
           - Calculate winrates for all 10 participants using that anchor
           - Average team vs enemy winrates
        5. Average the 10 per-match results
        """
        logger.info("Starting matchmaking analysis")
        self._reset_run_state(puuid, created_at)
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
            team_avgs, enemy_avgs = await self._collect_match_averages(
                puuid, created_at, spine_match_ids
            )
            await self._finalize_completed_analysis(
                puuid, created_at, team_avgs, enemy_avgs
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

    async def _write_active_run(
        self, puuid: str, created_at: datetime, **values: Any
    ) -> None:
        """Guarded UPDATE of one active run, committed.

        The maintenance check, the `_active_run_where` guard and the commit
        were written out at four call sites; only the values ever differed.
        Deliberately not used by `cancel_analysis`, which omits the
        maintenance check on purpose, nor by `_finalize_completed_analysis`,
        which reads the status back before it commits.
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
        # No endTime — actual latest matches. This call cannot be skipped.
        spine_match_ids = await self._api_fetch_match_ids(
            puuid,
            count=MATCHES_TO_ANALYZE,
            required=True,
        )
        found = len(spine_match_ids) if spine_match_ids else 0
        if found < MIN_MATCHES_REQUIRED:
            await self._complete_with_error(
                puuid,
                created_at,
                "Player doesn't have enough ranked matches for this analysis. "
                f"Found {found}, "
                f"need {MIN_MATCHES_REQUIRED}.",
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
    ) -> tuple[list[float], list[float]]:
        team_avgs: list[float] = []
        enemy_avgs: list[float] = []

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
            result = await self._process_match(
                puuid, created_at, match_id, match_anchor_seconds
            )
            if result:
                if result["team"]:
                    team_avgs.append(fmean(result["team"]))
                if result["enemy"]:
                    enemy_avgs.append(fmean(result["enemy"]))

        return team_avgs, enemy_avgs

    async def _finalize_completed_analysis(
        self,
        puuid: str,
        created_at: datetime,
        team_avgs: list[float],
        enemy_avgs: list[float],
    ) -> None:
        results = _build_completion_results(
            team_avgs, enemy_avgs, matches_analyzed=self.matches_analyzed
        )
        self.requests_saved = max(THEORETICAL_MAX_REQUESTS - self.api_calls_made, 0)
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

    # ================================================================
    # Match Processing
    # ================================================================

    async def _process_match(
        self,
        analysis_puuid: str,
        analysis_created_at: datetime,
        match_id: str,
        end_time_seconds: int,
    ) -> dict[str, list[float]] | None:
        """Process a single spine match: compute winrates for all participants."""
        participants = await self._get_match_participants(match_id)
        if not participants:
            return None

        target_team = _team_id_for_player(participants, analysis_puuid)
        if target_team is None:
            logger.warning("Current player not in match", match_id=match_id)
            return None

        team_wrs: list[float] = []
        enemy_wrs: list[float] = []

        for p_puuid, team_id in participants:
            wr = await self._cached_player_winrate(
                p_puuid, end_time_seconds, analysis_puuid, analysis_created_at
            )
            if wr is not None:
                (team_wrs if team_id == target_team else enemy_wrs).append(wr)

        return {"team": team_wrs, "enemy": enemy_wrs}

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

    async def _calculate_player_winrate(
        self,
        puuid: str,
        end_time_seconds: int,
    ) -> float | None:
        """
        Calculate a player's winrate from their ranked matches
        ending before the anchor time.

        Uses the last 10 ranked matches at that anchor time for every player.

        DB-first: if we have ≥10 fully_analyzed ranked matches in DB, use those.
        Otherwise fall back to API.
        """
        anchor_ms = end_time_seconds * 1000

        result = await self.db.execute(
            select(MatchParticipant.win)
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
        # `.scalars()`, not `.all()`: SQLAlchemy types a single-column select as
        # `Result[Tuple[bool]]`, and taking the rows threw that away into
        # `Sequence[Any]` -- so `if w` would have accepted a row of any shape.
        db_wins = result.scalars().all()

        if len(db_wins) >= MATCHES_FOR_WINRATE:
            return self._winrate_from_rows(db_wins)

        match_ids = await self._get_match_ids_for_player(puuid, end_time_seconds)
        if not match_ids:
            return self._winrate_from_rows(db_wins)
        return await self._winrate_from_match_ids(match_ids, puuid)

    def _winrate_from_rows(self, db_wins: Sequence[bool]) -> float | None:
        if not db_wins:
            return None
        self.matches_analyzed += len(db_wins)
        return sum(db_wins) / len(db_wins)

    async def _winrate_from_match_ids(
        self, match_ids: list[str], puuid: str
    ) -> float | None:
        wins = 0
        total = 0
        for mid in match_ids:
            win = await self._get_win_status(mid, puuid)
            if win is not None:
                total += 1
                if win:
                    wins += 1
        if total <= 0:
            return None
        self.matches_analyzed += total
        return wins / total

    # ================================================================
    # Data Access (DB-first)
    # ================================================================

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

        # Not in DB → fetch from API
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
            # Found in DB - no API call needed
            return win

        # Fetch from API
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

    # ================================================================
    # Rate-Limited API Calls
    # ================================================================

    async def _api_call_with_retries[T](
        self,
        fetch: Callable[[], Awaitable[T]],
        *,
        required: bool,
        operation: str,
        **log_fields: object,
    ) -> T | None:
        """Run one Riot call under the shared rate-limit retry policy.

        Returns None when capacity is unavailable, the error is recoverable,
        or retries are exhausted; `required=True` raises instead.

        These attempts stack on the Riot client's own tenacity retry of 429/5xx:
        the client may sleep through several server retry_afters inside one
        `fetch()` before this loop waits again. That is the intended posture for
        this long-running analysis — prefer eventually completing over failing
        fast.
        """
        for attempt in range(self.MAX_RATE_LIMIT_ATTEMPTS):
            try:
                result = await fetch()
                await self._record_successful_api_call()
                return result

            except RateLimitError as e:
                retry_after = _rate_limit_retry_after(e)
                logger.info(
                    "Rate limit during Riot call",
                    operation=operation,
                    retry_after=retry_after,
                    attempt=attempt + 1,
                    **log_fields,
                )
                if attempt + 1 == self.MAX_RATE_LIMIT_ATTEMPTS:
                    break
                await self._wait_for_rate_limit(retry_after)

            except RiotAPIError as e:
                logger.warning(
                    "Riot call failed",
                    operation=operation,
                    error_type=type(e).__name__,
                    **log_fields,
                )
                if _should_reraise_riot_error(e, required=required):
                    raise
                return None

        logger.warning("Riot call retries exhausted", operation=operation, **log_fields)
        await self._clear_rate_limit_wait_if_active()
        _raise_if_retries_exhausted(required=required)
        return None

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

    async def _record_successful_api_call(self) -> None:
        self.api_calls_made += 1
        await self._clear_rate_limit_wait_if_active()

    # ================================================================
    # Rate Limit Waiting
    # ================================================================

    async def _wait_for_rate_limit(self, retry_after: int) -> None:
        """Wait for rate limit reset while persisting lifecycle timing."""
        wait_time = min(retry_after, MAX_RATE_LIMIT_WAIT)
        reset_at = datetime.now(UTC) + timedelta(seconds=wait_time)

        logger.info("Waiting for rate limit", wait_seconds=wait_time, reset_at=reset_at)
        self._is_waiting_for_rate_limit = True
        await self._set_rate_limit_reset(reset_at)
        await asyncio.sleep(wait_time)

    async def _clear_rate_limit_wait_if_active(self) -> None:
        """Clear persisted rate-limit timing once requests can proceed again."""
        if not self._is_waiting_for_rate_limit:
            return
        self._is_waiting_for_rate_limit = False
        await self._set_rate_limit_reset(None, force_clear=True)

    async def _set_rate_limit_reset(
        self,
        reset_at: datetime | None,
        force_clear: bool = False,
    ) -> None:
        """Update the persisted rate-limit lifecycle timing."""
        if not self._has_current_analysis():
            return
        try:
            result = await self.db.execute(
                select(MatchmakingAnalysis.rate_limit_reset_at).where(
                    self._active_run_where(*self._current_run_identity())
                )
            )
            current_reset = result.scalar_one_or_none()
            now = datetime.now(UTC)
            next_reset = self._next_rate_limit_reset(
                reset_at, current_reset, now, force_clear
            )

            await self._write_active_run(
                *self._current_run_identity(),
                status=self._status_for_rate_limit(next_reset),
                rate_limit_reset_at=next_reset,
                requests_saved=self.requests_saved,
            )
        except Exception as e:
            logger.warning(
                "Failed to set rate_limit_reset_at",
                error_type=type(e).__name__,
            )
            await rollback_quietly(self.db)

    def _has_current_analysis(self) -> bool:
        return bool(self._current_analysis_puuid and self._current_analysis_created_at)

    def _current_run_identity(self) -> tuple[str, datetime]:
        """The identity of the run this worker owns; guarded by `_has_current_analysis`."""
        assert self._current_analysis_puuid is not None
        assert self._current_analysis_created_at is not None
        return self._current_analysis_puuid, self._current_analysis_created_at

    @staticmethod
    def _next_rate_limit_reset(
        reset_at: datetime | None,
        current_reset: datetime | None,
        now: datetime,
        force_clear: bool,
    ) -> datetime | None:
        if reset_at is None and not force_clear:
            if current_reset is not None and current_reset > now:
                return current_reset
            return reset_at
        if (
            reset_at is not None
            and current_reset is not None
            and current_reset > reset_at
        ):
            return current_reset
        return reset_at

    @staticmethod
    def _status_for_rate_limit(next_reset: datetime | None) -> str:
        if next_reset is not None:
            return "waiting_rate_limit"
        return "in_progress"

    # ================================================================
    # Analysis Record Helpers
    # ================================================================

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
