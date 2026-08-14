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
- Uses DBRateLimiter with priority 3 (lowest) to yield to Match Fetcher/Player Updater
- When rate limited, persists rate_limit_reset_at for lifecycle diagnostics
- Waits and retries automatically (up to 30 minutes total)
"""

import asyncio
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple, cast

import structlog
from sqlalchemy import and_, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import db_manager
from app.core.db_session import rollback_quietly
from app.core.riot_api.client import RiotAPIClient
from app.core.riot_api.credential_health import create_tracked_riot_api_client
from app.core.riot_api.db_rate_limiter import DBRateLimiter, RateLimitComponent
from app.core.riot_api.errors import (
    AuthenticationError,
    ForbiddenError,
    RateLimitError,
    RiotAPIError,
)
from app.core.riot_api.models import MatchDTO
from app.features.matches.models import Match
from app.features.matches.participants import MatchParticipant

from .models import MatchmakingAnalysis
from .schemas import (
    MatchmakingAnalysisHistoryItem,
    MatchmakingAnalysisHistoryResponse,
    MatchmakingAnalysisResponse,
    MatchmakingAnalysisStatus,
    MatchmakingAnalysisStatusResponse,
)

logger = structlog.get_logger(__name__)

MAX_RATE_LIMIT_WAIT = 120
ACTIVE_ANALYSIS_STATUSES = ("pending", "in_progress", "waiting_rate_limit")


@dataclass(frozen=True)
class RunningAnalysis:
    """Process-local handle for one persisted analysis run."""

    created_at: datetime
    task: asyncio.Task[None]


_running_analyses: Dict[str, RunningAnalysis] = {}


class MatchmakingAnalysisRuntimeError(Exception):
    """Internal failure carrying only reviewed client-safe diagnostics."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(code)
        self.code = code
        self.client_message = message


async def _ensure_riot_writer_maintenance_is_inactive(session: AsyncSession) -> None:
    """Avoid importing the jobs package until a Riot-data write runs."""
    from app.features.jobs.maintenance import ensure_riot_writer_maintenance_is_inactive

    await ensure_riot_writer_maintenance_is_inactive(session)


class MatchmakingAnalysisService:
    """Service for analyzing matchmaking fairness."""

    MATCHES_TO_ANALYZE = 10
    MATCHES_FOR_WINRATE = 10
    MIN_MATCHES_REQUIRED = 10
    EXPECTED_PLAYERS = 100

    def __init__(self, db: AsyncSession, riot_client: RiotAPIClient):
        self.db = db
        self.riot_client = riot_client
        self.rate_limiter: Optional[DBRateLimiter] = None
        self.requests_saved: int = 0
        self.api_calls_made: int = 0  # Track actual API calls for savings calculation
        self._is_waiting_for_rate_limit: bool = False
        self._current_analysis_puuid: Optional[str] = None
        self._current_analysis_created_at: Optional[datetime] = None
        self._winrate_cache: Dict[str, Optional[float]] = {}

    # ================================================================
    # Public API
    # ================================================================

    async def check_player_has_enough_matches(self, puuid: str) -> Tuple[bool, int]:
        """Check if player has at least MIN_MATCHES_REQUIRED ranked matches."""
        try:
            match_list = await self.riot_client.get_match_list_by_puuid(
                puuid=puuid,
                start=0,
                count=self.MIN_MATCHES_REQUIRED,
                queue=420,
            )
            count = len(match_list.match_ids)
            return count >= self.MIN_MATCHES_REQUIRED, count
        except RiotAPIError as e:
            logger.error(
                "Failed to check player match count",
                puuid=puuid,
                error_type=type(e).__name__,
            )
            raise

    async def start_analysis(self, puuid: str) -> MatchmakingAnalysisResponse:
        """Create or attach to one active analysis and return immediately."""
        await _ensure_riot_writer_maintenance_is_inactive(self.db)

        running = _running_analyses.get(puuid)
        if running and running.task.done():
            _running_analyses.pop(puuid, None)

        existing = await self._get_active_analysis(puuid)
        if existing:
            logger.info("Attaching to active analysis", puuid=puuid)
            self._ensure_background_task(puuid, existing.created_at)
            return MatchmakingAnalysisResponse.model_validate(existing)

        now = datetime.now(timezone.utc)
        analysis = MatchmakingAnalysis(
            puuid=puuid,
            created_at=now,
            status="pending",
            puuid_progress={},
        )
        self.db.add(analysis)
        try:
            await self.db.commit()
            await self.db.refresh(analysis)
        except IntegrityError:
            await self.db.rollback()
            existing = await self._get_active_analysis(puuid)
            if not existing:
                raise
            logger.info("Attached after concurrent start", puuid=puuid)
            self._ensure_background_task(puuid, existing.created_at)
            return MatchmakingAnalysisResponse.model_validate(existing)

        logger.info("Created new matchmaking analysis", puuid=puuid, created_at=now)
        self._ensure_background_task(puuid, now)
        return MatchmakingAnalysisResponse.model_validate(analysis)

    async def cancel_analysis(self, puuid: str, created_at: datetime) -> bool:
        """Cancel the exact active run while retaining its terminal record."""
        result = await self.db.execute(
            select(MatchmakingAnalysis).where(
                and_(
                    MatchmakingAnalysis.puuid == puuid,
                    MatchmakingAnalysis.created_at == created_at,
                    MatchmakingAnalysis.status.in_(ACTIVE_ANALYSIS_STATUSES),
                )
            )
        )
        if result.scalar_one_or_none() is None:
            return False

        await self.db.execute(
            update(MatchmakingAnalysis)
            .where(
                and_(
                    MatchmakingAnalysis.puuid == puuid,
                    MatchmakingAnalysis.created_at == created_at,
                    MatchmakingAnalysis.status.in_(ACTIVE_ANALYSIS_STATUSES),
                )
            )
            .values(
                status="cancelled",
                completed_at=datetime.now(timezone.utc),
                error_code=None,
                error_message=None,
                rate_limit_reset_at=None,
            )
        )
        await self.db.commit()

        running = _running_analyses.get(puuid)
        if running and running.created_at == created_at and not running.task.done():
            running.task.cancel()
            try:
                await running.task
            except asyncio.CancelledError:
                pass
            except Exception:
                pass
        logger.info("Analysis cancelled", puuid=puuid, created_at=created_at)
        return True

    async def get_latest_completed_analysis(
        self, puuid: str
    ) -> Optional[MatchmakingAnalysisResponse]:
        """Get the latest completed analysis for a player (excluding errors)."""
        result = await self.db.execute(
            select(MatchmakingAnalysis)
            .where(
                and_(
                    MatchmakingAnalysis.puuid == puuid,
                    MatchmakingAnalysis.status == "completed",
                    MatchmakingAnalysis.results.isnot(None),
                )
            )
            .order_by(MatchmakingAnalysis.created_at.desc())
            .limit(10)
        )
        analyses = result.scalars().all()
        for analysis in analyses:
            return MatchmakingAnalysisResponse.model_validate(analysis)
        return None

    async def get_latest_analysis(
        self, puuid: str
    ) -> Optional[MatchmakingAnalysisResponse]:
        """Get the latest analysis for a player."""
        result = await self.db.execute(
            select(MatchmakingAnalysis)
            .where(MatchmakingAnalysis.puuid == puuid)
            .order_by(MatchmakingAnalysis.created_at.desc())
            .limit(1)
        )
        analysis = result.scalar_one_or_none()
        if not analysis:
            return None
        return MatchmakingAnalysisResponse.model_validate(analysis)

    async def get_analysis_status(
        self, puuid: str, created_at: datetime
    ) -> Optional[MatchmakingAnalysisStatusResponse]:
        """Get status of a specific analysis."""
        result = await self.db.execute(
            select(MatchmakingAnalysis).where(
                and_(
                    MatchmakingAnalysis.puuid == puuid,
                    MatchmakingAnalysis.created_at == created_at,
                )
            )
        )
        analysis = result.scalar_one_or_none()
        if not analysis:
            return None

        puuid_progress = analysis.puuid_progress or {}
        progress = sum(1 for v in puuid_progress.values() if v)
        total = len(puuid_progress)

        results_schema = None
        if analysis.status == "completed" and analysis.results:
            from .schemas import MatchmakingAnalysisResults

            results_schema = MatchmakingAnalysisResults(
                team_avg_winrate=analysis.results.get("team_avg_winrate", 0),
                enemy_avg_winrate=analysis.results.get("enemy_avg_winrate", 0),
                matches_analyzed=analysis.results.get("matches_analyzed", 0),
            )

        return MatchmakingAnalysisStatusResponse(
            puuid=analysis.puuid,
            status=cast(MatchmakingAnalysisStatus, analysis.status),
            progress=progress,
            total_puuids=total,
            results=results_schema,
            created_at=analysis.created_at,
            started_at=analysis.started_at,
            completed_at=analysis.completed_at,
            error_code=analysis.error_code,
            error_message=analysis.error_message,
            requests_saved=analysis.requests_saved or 0,
            rate_limit_reset_at=analysis.rate_limit_reset_at,
        )

    async def get_analysis_history(
        self, puuid: str, limit: int = 20
    ) -> MatchmakingAnalysisHistoryResponse:
        """Get history of completed analyses for a player."""
        result = await self.db.execute(
            select(MatchmakingAnalysis)
            .where(
                and_(
                    MatchmakingAnalysis.puuid == puuid,
                    MatchmakingAnalysis.status == "completed",
                    MatchmakingAnalysis.results.isnot(None),
                )
            )
            .order_by(MatchmakingAnalysis.created_at.desc())
            .limit(limit)
        )
        analyses = result.scalars().all()
        items = []
        for a in analyses:
            if a.results:
                items.append(
                    MatchmakingAnalysisHistoryItem(
                        created_at=a.created_at,
                        team_avg_winrate=a.results.get("team_avg_winrate", 0),
                        enemy_avg_winrate=a.results.get("enemy_avg_winrate", 0),
                    )
                )
        return MatchmakingAnalysisHistoryResponse(items=items)

    async def delete_analysis(self, puuid: str, created_at: datetime) -> bool:
        """Delete a specific completed analysis record by puuid and created_at."""
        result = await self.db.execute(
            select(MatchmakingAnalysis).where(
                and_(
                    MatchmakingAnalysis.puuid == puuid,
                    MatchmakingAnalysis.created_at == created_at,
                    MatchmakingAnalysis.status == "completed",
                )
            )
        )
        analysis = result.scalar_one_or_none()
        if not analysis:
            return False
        await self.db.delete(analysis)
        await self.db.commit()
        logger.info("analysis_deleted", puuid=puuid, created_at=str(created_at))
        return True

    async def _get_active_analysis(self, puuid: str) -> Optional[MatchmakingAnalysis]:
        """Return the one persisted active analysis for a player, if present."""
        result = await self.db.execute(
            select(MatchmakingAnalysis)
            .where(
                MatchmakingAnalysis.puuid == puuid,
                MatchmakingAnalysis.status.in_(ACTIVE_ANALYSIS_STATUSES),
            )
            .order_by(MatchmakingAnalysis.created_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    def _ensure_background_task(self, puuid: str, created_at: datetime) -> None:
        """Start the process-local worker once for the persisted active run."""
        running = _running_analyses.get(puuid)
        if running and running.created_at == created_at and not running.task.done():
            return

        task = asyncio.create_task(self._run_analysis_background(puuid, created_at))
        _running_analyses[puuid] = RunningAnalysis(
            created_at=created_at,
            task=task,
        )

    # ================================================================
    # Background Analysis
    # ================================================================

    async def _run_analysis_background(self, puuid: str, created_at: datetime) -> None:
        """Run analysis in background with its own DB session."""
        rate_limiter = None
        try:
            async with db_manager.get_session() as db:
                try:
                    riot_client = await create_tracked_riot_api_client(db)
                except ValueError as error:
                    raise AuthenticationError(
                        "No active Riot API key configured"
                    ) from error

                async with riot_client:
                    rate_limiter = DBRateLimiter(
                        db, RateLimitComponent.MATCHMAKING_ANALYSIS
                    )
                    service = MatchmakingAnalysisService(db, riot_client)
                    service.rate_limiter = rate_limiter
                    await service._run_analysis(puuid, created_at)
        except asyncio.CancelledError:
            # Deliberately leaves the persisted row active. This also fires when
            # process shutdown cancels the task, and the documented contract is
            # that a restart resumes the run with its completed progress intact;
            # writing `cancelled` here would discard that work on every deploy.
            # An explicit user cancellation is unaffected: `cancel_analysis`
            # commits the terminal row before cancelling this task.
            logger.info(
                "Background analysis task cancelled; persisted run left active",
                puuid=puuid,
                created_at=created_at,
            )
            raise
        except Exception as e:
            logger.error(
                "Background analysis failed",
                puuid=puuid,
                error_type=type(e).__name__,
                exc_info=True,
            )
            error_code, error_message = self._safe_failure_details(e)
            try:
                async with db_manager.get_session() as db:
                    await _ensure_riot_writer_maintenance_is_inactive(db)
                    await db.execute(
                        update(MatchmakingAnalysis)
                        .where(
                            and_(
                                MatchmakingAnalysis.puuid == puuid,
                                MatchmakingAnalysis.created_at == created_at,
                                MatchmakingAnalysis.status.in_(
                                    ACTIVE_ANALYSIS_STATUSES
                                ),
                            )
                        )
                        .values(
                            status="failed",
                            rate_limit_reset_at=None,
                            completed_at=datetime.now(timezone.utc),
                            error_code=error_code,
                            error_message=error_message,
                        )
                    )
                    await db.commit()
            except Exception:
                pass
        finally:
            running = _running_analyses.get(puuid)
            if running and running.task is asyncio.current_task():
                _running_analyses.pop(puuid, None)
            if rate_limiter:
                try:
                    async with db_manager.get_session() as db:
                        rate_limiter.db = db
                        await rate_limiter.release()
                except Exception:
                    pass

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
        logger.info("Starting matchmaking analysis", puuid=puuid, created_at=created_at)
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
            logger.error(
                "Analysis failed",
                puuid=puuid,
                error_type=type(e).__name__,
                exc_info=True,
            )
            raise

    def _reset_run_state(self, puuid: str, created_at: datetime) -> None:
        self.requests_saved = 0
        self.api_calls_made = 0
        self._current_analysis_puuid = puuid
        self._current_analysis_created_at = created_at
        self._winrate_cache = {}

    async def _mark_analysis_in_progress(
        self, puuid: str, created_at: datetime
    ) -> None:
        await _ensure_riot_writer_maintenance_is_inactive(self.db)
        await self.db.execute(
            update(MatchmakingAnalysis)
            .where(
                and_(
                    MatchmakingAnalysis.puuid == puuid,
                    MatchmakingAnalysis.created_at == created_at,
                    MatchmakingAnalysis.status.in_(ACTIVE_ANALYSIS_STATUSES),
                )
            )
            .values(
                status="in_progress",
                started_at=func.coalesce(
                    MatchmakingAnalysis.started_at,
                    datetime.now(timezone.utc),
                ),
                error_code=None,
                error_message=None,
            )
        )
        await self.db.commit()

    async def _load_spine_match_ids(
        self, puuid: str, created_at: datetime
    ) -> Optional[List[str]]:
        # No endTime — actual latest matches. This call cannot be skipped.
        spine_match_ids = await self._api_fetch_match_ids(
            puuid,
            count=self.MATCHES_TO_ANALYZE,
            required=True,
        )
        found = len(spine_match_ids) if spine_match_ids else 0
        if found < self.MIN_MATCHES_REQUIRED:
            await self._complete_with_error(
                puuid,
                created_at,
                "Player doesn't have enough ranked matches for this analysis. "
                f"Found {found}, "
                f"need {self.MIN_MATCHES_REQUIRED}.",
                error_code="not_enough_matches",
            )
            return None
        return spine_match_ids

    async def _ensure_spine_matches_ready(
        self, puuid: str, created_at: datetime, spine_match_ids: List[str]
    ) -> bool:
        spine_in_db_count = 0
        for mid in spine_match_ids:
            was_in_db = await self._ensure_match_in_db(mid)
            if was_in_db:
                spine_in_db_count += 1

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
            puuid=puuid,
            count=len(spine_match_ids),
            in_db=spine_in_db_count,
        )
        return True

    async def _initialize_progress_keys(
        self, puuid: str, created_at: datetime, spine_match_ids: List[str]
    ) -> None:
        all_keys = []
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
        logger.info("Progress initialized", puuid=puuid, total_keys=len(all_keys))

    async def _collect_match_averages(
        self, puuid: str, created_at: datetime, spine_match_ids: List[str]
    ) -> Tuple[List[float], List[float]]:
        team_avgs: List[float] = []
        enemy_avgs: List[float] = []

        for idx, match_id in enumerate(spine_match_ids):
            match_anchor = await self._get_game_start_timestamp(match_id)
            if match_anchor is None:
                logger.warning(
                    f"Could not get timestamp for match {match_id}, skipping"
                )
                continue

            match_anchor_seconds = match_anchor // 1000 + 1
            logger.info(
                f"Processing match {idx + 1}/{len(spine_match_ids)}",
                match_id=match_id,
                anchor=match_anchor,
            )
            result = await self._process_match(
                puuid, created_at, match_id, match_anchor_seconds
            )
            if result:
                self._append_match_side_averages(team_avgs, enemy_avgs, result)

        return team_avgs, enemy_avgs

    @staticmethod
    def _append_match_side_averages(
        team_avgs: List[float],
        enemy_avgs: List[float],
        result: Dict[str, List[float]],
    ) -> None:
        if result["team"]:
            team_avgs.append(sum(result["team"]) / len(result["team"]))
        if result["enemy"]:
            enemy_avgs.append(sum(result["enemy"]) / len(result["enemy"]))

    def _build_completion_results(
        self, team_avgs: List[float], enemy_avgs: List[float]
    ) -> Dict[str, float | int]:
        team_avg = sum(team_avgs) / len(team_avgs) if team_avgs else 0.0
        enemy_avg = sum(enemy_avgs) / len(enemy_avgs) if enemy_avgs else 0.0

        expected_other_players = self.MATCHES_TO_ANALYZE * 9
        expected_players = expected_other_players + 1
        expected_match_details_per_other = max(1, self.MATCHES_FOR_WINRATE - 1)
        # Basis size shown in UI:
        # 10 (current player's matches) + 90 players * 10 matches each = 910
        expected_matches_analyzed = self.MATCHES_TO_ANALYZE + (
            expected_other_players * self.MATCHES_FOR_WINRATE
        )

        # Theoretical maximum without DB:
        #   - 1 call for current player's spine IDs
        #   - expected_other_players calls for other players' match IDs
        #   - MATCHES_TO_ANALYZE match details for spine matches
        #   - expected_other_players * (MATCHES_FOR_WINRATE - 1) additional
        #     match details (1 of each player's 10 matches is the already-known
        #     spine match)
        match_list_calls = 1 + expected_other_players
        match_detail_calls = self.MATCHES_TO_ANALYZE + (
            expected_other_players * expected_match_details_per_other
        )
        theoretical_max = match_list_calls + match_detail_calls
        self.requests_saved = max(theoretical_max - self.api_calls_made, 0)

        return {
            "team_avg_winrate": round(team_avg, 4),
            "enemy_avg_winrate": round(enemy_avg, 4),
            "matches_analyzed": expected_matches_analyzed,
            "players_analyzed": expected_players,
        }

    async def _finalize_completed_analysis(
        self,
        puuid: str,
        created_at: datetime,
        team_avgs: List[float],
        enemy_avgs: List[float],
    ) -> None:
        results = self._build_completion_results(team_avgs, enemy_avgs)
        now = datetime.now(timezone.utc)
        await _ensure_riot_writer_maintenance_is_inactive(self.db)
        await self.db.execute(
            update(MatchmakingAnalysis)
            .where(
                and_(
                    MatchmakingAnalysis.puuid == puuid,
                    MatchmakingAnalysis.created_at == created_at,
                    MatchmakingAnalysis.status.in_(ACTIVE_ANALYSIS_STATUSES),
                )
            )
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
                and_(
                    MatchmakingAnalysis.puuid == puuid,
                    MatchmakingAnalysis.created_at == created_at,
                )
            )
        )
        if completion_status.scalar_one_or_none() != "completed":
            await self.db.rollback()
            logger.info(
                "Analysis completion ignored after terminal state",
                puuid=puuid,
                created_at=created_at,
            )
            return

        from app.features.players.models import Player

        await self.db.execute(
            update(Player)
            .where(Player.puuid == puuid)
            .values(last_matchmaking_analysis=now)
        )
        await self.db.commit()

        logger.info(
            "Analysis completed",
            puuid=puuid,
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
    ) -> Optional[Dict[str, List[float]]]:
        """Process a single spine match: compute winrates for all participants."""
        participants = await self._get_match_participants(match_id)
        if not participants:
            return None

        target_team = self._team_id_for_player(participants, analysis_puuid)
        if target_team is None:
            logger.warning("Current player not in match", match_id=match_id)
            return None

        team_wrs: List[float] = []
        enemy_wrs: List[float] = []

        for p_puuid, team_id in participants:
            wr = await self._cached_player_winrate(
                p_puuid, end_time_seconds, analysis_puuid, analysis_created_at
            )
            self._append_side_winrate(team_wrs, enemy_wrs, wr, team_id, target_team)

        return {"team": team_wrs, "enemy": enemy_wrs}

    @staticmethod
    def _team_id_for_player(
        participants: List[Tuple[str, int]], analysis_puuid: str
    ) -> Optional[int]:
        for p_puuid, team_id in participants:
            if p_puuid == analysis_puuid:
                return team_id
        return None

    async def _cached_player_winrate(
        self,
        p_puuid: str,
        end_time_seconds: int,
        analysis_puuid: str,
        analysis_created_at: datetime,
    ) -> Optional[float]:
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

    @staticmethod
    def _append_side_winrate(
        team_wrs: List[float],
        enemy_wrs: List[float],
        wr: Optional[float],
        team_id: int,
        target_team: int,
    ) -> None:
        if wr is None:
            return
        if team_id == target_team:
            team_wrs.append(wr)
        else:
            enemy_wrs.append(wr)

    async def _calculate_player_winrate(
        self,
        puuid: str,
        end_time_seconds: int,
    ) -> Optional[float]:
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
                Match.queue_id == 420,
                Match.game_start_timestamp <= anchor_ms,
                Match.fully_analyzed.is_(True),
            )
            .order_by(Match.game_start_timestamp.desc())
            .limit(self.MATCHES_FOR_WINRATE)
        )
        db_wins = result.all()

        if len(db_wins) >= self.MATCHES_FOR_WINRATE:
            return self._winrate_from_rows(db_wins)

        match_ids = await self._get_match_ids_for_player(puuid, end_time_seconds)
        if not match_ids:
            return self._winrate_from_rows(db_wins)
        return await self._winrate_from_match_ids(match_ids, puuid)

    @staticmethod
    def _winrate_from_rows(db_wins: Sequence[Any]) -> Optional[float]:
        if not db_wins:
            return None
        win_count = sum(1 for (w,) in db_wins if w)
        return win_count / len(db_wins)

    async def _winrate_from_match_ids(
        self, match_ids: List[str], puuid: str
    ) -> Optional[float]:
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
        return wins / total

    # ================================================================
    # Data Access (DB-first)
    # ================================================================

    async def _get_match_participants(self, match_id: str) -> List[Tuple[str, int]]:
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

    async def _get_win_status(self, match_id: str, puuid: str) -> Optional[bool]:
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

    async def _ensure_match_in_db(self, match_id: str) -> bool:
        """Ensure match exists in DB with fully_analyzed=True.

        Uses global ensure_match_fully_analyzed utility which handles:
        - Already fully analyzed → skip (no API call)
        - Exists but not fully analyzed → re-fetch and update
        - Not in DB → fetch and insert

        Returns True if match was already in DB, False if API call was needed.
        """

        result = await self.db.execute(
            select(Match.match_id, Match.fully_analyzed).where(
                Match.match_id == match_id
            )
        )
        row = result.one_or_none()
        if row is not None and row.fully_analyzed:
            return True

        # Need API call — use rate limiter
        dto = await self._api_fetch_match(match_id)
        if dto:
            await self._store_fetched_match(dto)
        return False

    async def _store_fetched_match(self, match_dto: object) -> None:
        """Persist an API-fetched match only while cleanup is inactive."""
        from app.core.match_utils import _upsert_match

        await _ensure_riot_writer_maintenance_is_inactive(self.db)
        await _upsert_match(self.db, match_dto)

    async def _get_game_start_timestamp(self, match_id: str) -> Optional[int]:
        """Get game_start_timestamp for a match from DB."""
        result = await self.db.execute(
            select(Match.game_start_timestamp).where(Match.match_id == match_id)
        )
        return result.scalar_one_or_none()

    async def _get_match_ids_for_player(
        self,
        puuid: str,
        end_time_seconds: int,
    ) -> List[str]:
        """Get a player's ranked match IDs with endTime from API."""
        return await self._api_fetch_match_ids(
            puuid,
            count=self.MATCHES_FOR_WINRATE,
            end_time=end_time_seconds,
        )

    # ================================================================
    # Rate-Limited API Calls
    # ================================================================

    async def _api_fetch_match_ids(
        self,
        puuid: str,
        count: int = 10,
        end_time: Optional[int] = None,
        *,
        required: bool = False,
    ) -> List[str]:
        """Fetch match IDs from Riot API with rate limit handling."""
        max_retries = 10
        for attempt in range(max_retries):
            try:
                if not await self._acquire_rate_limit_slot(
                    required=required,
                    unavailable_message="Rate limit: cannot fetch match IDs",
                    puuid=puuid,
                ):
                    return []

                match_list = await self.riot_client.get_match_list_by_puuid(
                    puuid=puuid,
                    start=0,
                    count=count,
                    queue=420,
                    end_time=end_time,
                )
                await self._record_successful_api_call()
                return match_list.match_ids

            except RateLimitError as e:
                retry_after = self._rate_limit_retry_after(e)
                logger.info(
                    "Rate limit on match ID fetch",
                    puuid=puuid,
                    retry_after=retry_after,
                    attempt=attempt + 1,
                )
                await self._wait_for_rate_limit(retry_after)

            except RiotAPIError as e:
                logger.error(
                    "Failed to fetch match IDs",
                    puuid=puuid,
                    error_type=type(e).__name__,
                )
                if self._should_reraise_riot_error(e, required=required):
                    raise
                return []

        logger.warning("Max retries for match ID fetch", puuid=puuid)
        self._raise_if_retries_exhausted(required=required)
        return []

    async def _api_fetch_match(
        self, match_id: str, *, required: bool = False
    ) -> Optional[MatchDTO]:
        """Fetch a single match from API. Returns MatchDTO or None."""
        max_retries = 10
        for attempt in range(max_retries):
            try:
                if not await self._acquire_rate_limit_slot(
                    required=required,
                    unavailable_message="Rate limit: cannot fetch match",
                    match_id=match_id,
                ):
                    return None

                dto = await self.riot_client.get_match(match_id)
                await self._record_successful_api_call()
                return dto

            except RateLimitError as e:
                retry_after = self._rate_limit_retry_after(e)
                logger.info(
                    "Rate limit on match fetch",
                    match_id=match_id,
                    retry_after=retry_after,
                    attempt=attempt + 1,
                )
                await self._wait_for_rate_limit(retry_after)

            except RiotAPIError as e:
                logger.warning(
                    "Failed to fetch match",
                    match_id=match_id,
                    error_type=type(e).__name__,
                )
                if self._should_reraise_riot_error(e, required=required):
                    raise
                return None

        logger.warning("Max retries for match fetch", match_id=match_id)
        self._raise_if_retries_exhausted(required=required)
        return None

    async def _acquire_rate_limit_slot(
        self,
        *,
        required: bool,
        unavailable_message: str,
        **log_fields: object,
    ) -> bool:
        if self.rate_limiter is None:
            return True
        acquired = await self.rate_limiter.acquire_with_wait_callback(
            wait_callback=self._rate_limit_wait_callback,
        )
        if acquired:
            return True
        logger.warning(unavailable_message, **log_fields)
        if required:
            raise MatchmakingAnalysisRuntimeError(
                "rate_limit_unavailable",
                "The analysis is still unable to obtain Riot request "
                "capacity. Please try again later.",
            )
        return False

    async def _record_successful_api_call(self) -> None:
        if self.rate_limiter:
            await self.rate_limiter.record_request()
        self.api_calls_made += 1
        await self._clear_rate_limit_wait_if_active()

    @staticmethod
    def _rate_limit_retry_after(error: RateLimitError) -> int:
        return int(error.retry_after or 120)

    @staticmethod
    def _should_reraise_riot_error(error: RiotAPIError, *, required: bool) -> bool:
        return isinstance(error, (AuthenticationError, ForbiddenError)) or required

    def _raise_if_retries_exhausted(self, *, required: bool) -> None:
        if required:
            raise MatchmakingAnalysisRuntimeError(
                "rate_limit_wait_exhausted",
                "The analysis could not resume within the allowed Riot rate-limit "
                "wait. Please try again later.",
            )

    # ================================================================
    # Rate Limit Waiting
    # ================================================================

    async def _rate_limit_wait_callback(self, reset_at: Optional[datetime]) -> None:
        """Callback from DBRateLimiter.acquire_with_wait_callback.

        Called with the absolute window_end datetime when rate limited,
        or None when the wait-loop iteration ends. We only persist reset times
        when actively rate-limited, and clear after a successful API call.
        """
        if reset_at is None:
            return
        self._is_waiting_for_rate_limit = True
        await self._set_rate_limit_reset(reset_at)

    async def _wait_for_rate_limit(self, retry_after: int) -> None:
        """Wait for rate limit reset while persisting lifecycle timing."""
        wait_time = min(retry_after, MAX_RATE_LIMIT_WAIT)
        reset_at = datetime.now(timezone.utc) + timedelta(seconds=wait_time)

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
        reset_at: Optional[datetime],
        force_clear: bool = False,
    ) -> None:
        """Update the persisted rate-limit lifecycle timing."""
        if not self._has_current_analysis():
            return
        try:
            result = await self.db.execute(
                select(MatchmakingAnalysis.rate_limit_reset_at).where(
                    and_(
                        MatchmakingAnalysis.puuid == self._current_analysis_puuid,
                        MatchmakingAnalysis.created_at
                        == self._current_analysis_created_at,
                        MatchmakingAnalysis.status.in_(ACTIVE_ANALYSIS_STATUSES),
                    )
                )
            )
            current_reset = result.scalar_one_or_none()
            now = datetime.now(timezone.utc)
            next_reset = self._next_rate_limit_reset(
                reset_at, current_reset, now, force_clear
            )

            await _ensure_riot_writer_maintenance_is_inactive(self.db)
            await self.db.execute(
                update(MatchmakingAnalysis)
                .where(
                    and_(
                        MatchmakingAnalysis.puuid == self._current_analysis_puuid,
                        MatchmakingAnalysis.created_at
                        == self._current_analysis_created_at,
                        MatchmakingAnalysis.status.in_(ACTIVE_ANALYSIS_STATUSES),
                    )
                )
                .values(
                    status=self._status_for_rate_limit(next_reset),
                    rate_limit_reset_at=next_reset,
                    requests_saved=self.requests_saved,
                )
            )
            await self.db.commit()
        except Exception as e:
            logger.warning(
                "Failed to set rate_limit_reset_at",
                error_type=type(e).__name__,
            )
            await rollback_quietly(self.db)

    def _has_current_analysis(self) -> bool:
        return bool(self._current_analysis_puuid and self._current_analysis_created_at)

    @staticmethod
    def _next_rate_limit_reset(
        reset_at: Optional[datetime],
        current_reset: Optional[datetime],
        now: datetime,
        force_clear: bool,
    ) -> Optional[datetime]:
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
    def _status_for_rate_limit(next_reset: Optional[datetime]) -> str:
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
            select(MatchmakingAnalysis).where(
                and_(
                    MatchmakingAnalysis.puuid == puuid,
                    MatchmakingAnalysis.created_at == created_at,
                    MatchmakingAnalysis.status.in_(ACTIVE_ANALYSIS_STATUSES),
                )
            )
        )
        return result.scalar_one()

    async def _update_progress(
        self, puuid: str, created_at: datetime, progress: Dict[str, bool]
    ) -> None:
        await _ensure_riot_writer_maintenance_is_inactive(self.db)
        await self.db.execute(
            update(MatchmakingAnalysis)
            .where(
                and_(
                    MatchmakingAnalysis.puuid == puuid,
                    MatchmakingAnalysis.created_at == created_at,
                    MatchmakingAnalysis.status.in_(ACTIVE_ANALYSIS_STATUSES),
                )
            )
            .values(puuid_progress=progress)
        )
        await self.db.commit()

    async def _complete_with_error(
        self,
        puuid: str,
        created_at: datetime,
        msg: str,
        *,
        error_code: str,
    ) -> None:
        logger.warning("Analysis ended without results", puuid=puuid, code=error_code)
        await _ensure_riot_writer_maintenance_is_inactive(self.db)
        await self.db.execute(
            update(MatchmakingAnalysis)
            .where(
                and_(
                    MatchmakingAnalysis.puuid == puuid,
                    MatchmakingAnalysis.created_at == created_at,
                    MatchmakingAnalysis.status.in_(ACTIVE_ANALYSIS_STATUSES),
                )
            )
            .values(
                status="failed",
                completed_at=datetime.now(timezone.utc),
                results=None,
                error_code=error_code,
                error_message=msg,
                rate_limit_reset_at=None,
            )
        )
        await self.db.commit()
