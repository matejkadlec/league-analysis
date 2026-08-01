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
- When rate limited, sets rate_limit_reset_at timestamp so frontend shows countdown
- Waits and retries automatically (up to 30 minutes total)
"""

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

import structlog
from sqlalchemy import and_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import db_manager
from app.core.riot_api.client import RiotAPIClient
from app.core.riot_api.db_rate_limiter import DBRateLimiter, RateLimitComponent
from app.core.riot_api.errors import RateLimitError, RiotAPIError
from app.features.matches.models import Match
from app.features.matches.participants import MatchParticipant

from .models import MatchmakingAnalysis
from .schemas import (
    MatchmakingAnalysisHistoryItem,
    MatchmakingAnalysisHistoryResponse,
    MatchmakingAnalysisResponse,
    MatchmakingAnalysisStatusResponse,
)

logger = structlog.get_logger(__name__)

MAX_RATE_LIMIT_WAIT = 120
_running_analyses: Dict[str, asyncio.Task] = {}


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
                "Failed to check player match count", puuid=puuid, error=str(e)
            )
            raise

    async def start_analysis(self, puuid: str) -> MatchmakingAnalysisResponse:
        """Create analysis record and spawn background task."""
        if puuid in _running_analyses:
            task = _running_analyses[puuid]
            if task.done():
                _running_analyses.pop(puuid, None)
            else:
                logger.info("Analysis already running", puuid=puuid)
                latest = await self.get_latest_analysis(puuid)
                if latest:
                    return latest

        # Check for existing in-progress analysis in DB
        result = await self.db.execute(
            select(MatchmakingAnalysis)
            .where(
                and_(
                    MatchmakingAnalysis.puuid == puuid,
                    MatchmakingAnalysis.started_at.isnot(None),
                    MatchmakingAnalysis.completed_at.is_(None),
                )
            )
            .order_by(MatchmakingAnalysis.created_at.desc())
            .limit(1)
        )
        existing = result.scalar_one_or_none()
        if existing:
            logger.info("Resuming in-progress analysis", puuid=puuid)
            task = asyncio.create_task(
                self._run_analysis_background(puuid, existing.created_at)
            )
            _running_analyses[puuid] = task
            return MatchmakingAnalysisResponse.model_validate(existing)

        now = datetime.now(timezone.utc)
        analysis = MatchmakingAnalysis(puuid=puuid, created_at=now, puuid_progress={})
        self.db.add(analysis)
        await self.db.commit()
        await self.db.refresh(analysis)

        logger.info("Created new matchmaking analysis", puuid=puuid, created_at=now)
        task = asyncio.create_task(self._run_analysis_background(puuid, now))
        _running_analyses[puuid] = task
        return MatchmakingAnalysisResponse.model_validate(analysis)

    async def cancel_analysis(self, puuid: str) -> bool:
        """Cancel a running analysis for a player.

        Cancels the asyncio task (which triggers CancelledError in the background),
        then deletes the analysis record from DB. The task's CancelledError handler
        takes care of releasing the rate limiter.

        Returns True if an analysis was cancelled, False if none was running.
        """
        cancelled = False
        task = _running_analyses.get(puuid)
        if task and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            except Exception:
                pass
            cancelled = True

        _running_analyses.pop(puuid, None)

        # Delete any incomplete analysis records (pending or in-progress)
        result = await self.db.execute(
            select(MatchmakingAnalysis).where(
                and_(
                    MatchmakingAnalysis.puuid == puuid,
                    MatchmakingAnalysis.completed_at.is_(None),
                )
            )
        )
        analyses = result.scalars().all()
        if analyses:
            for analysis in analyses:
                await self.db.delete(analysis)
            await self.db.commit()
            logger.info(
                "Analysis cancelled and records deleted",
                puuid=puuid,
                count=len(analyses),
            )
            return True

        return cancelled

    async def get_latest_completed_analysis(
        self, puuid: str
    ) -> Optional[MatchmakingAnalysisResponse]:
        """Get the latest completed analysis for a player (excluding errors)."""
        result = await self.db.execute(
            select(MatchmakingAnalysis)
            .where(
                and_(
                    MatchmakingAnalysis.puuid == puuid,
                    MatchmakingAnalysis.completed_at.isnot(None),
                    MatchmakingAnalysis.results.isnot(None),
                )
            )
            .order_by(MatchmakingAnalysis.created_at.desc())
            .limit(10)
        )
        analyses = result.scalars().all()
        for analysis in analyses:
            if analysis.results and "error" in analysis.results:
                continue
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

        status = "pending"
        if analysis.completed_at:
            status = "completed"
        elif analysis.started_at:
            status = "in_progress"

        results_schema = None
        if analysis.results:
            from .schemas import MatchmakingAnalysisResults

            results_schema = MatchmakingAnalysisResults(
                team_avg_winrate=analysis.results.get("team_avg_winrate", 0),
                enemy_avg_winrate=analysis.results.get("enemy_avg_winrate", 0),
                matches_analyzed=analysis.results.get("matches_analyzed", 0),
            )

        return MatchmakingAnalysisStatusResponse(
            puuid=analysis.puuid,
            status=status,
            progress=progress,
            total_puuids=total,
            results=results_schema,
            created_at=analysis.created_at,
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
                    MatchmakingAnalysis.completed_at.isnot(None),
                    MatchmakingAnalysis.results.isnot(None),
                )
            )
            .order_by(MatchmakingAnalysis.created_at.desc())
            .limit(limit)
        )
        analyses = result.scalars().all()
        items = []
        for a in analyses:
            if a.results and "error" not in a.results:
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

    # ================================================================
    # Background Analysis
    # ================================================================

    async def _run_analysis_background(self, puuid: str, created_at: datetime) -> None:
        """Run analysis in background with its own DB session."""
        rate_limiter = None
        try:
            async with db_manager.get_session() as db:
                from app.core.config import get_riot_api_key

                api_key = await get_riot_api_key(db)

                async with RiotAPIClient(api_key=api_key) as riot_client:
                    rate_limiter = DBRateLimiter(
                        db, RateLimitComponent.MATCHMAKING_ANALYSIS
                    )
                    service = MatchmakingAnalysisService(db, riot_client)
                    service.rate_limiter = rate_limiter
                    await service._run_analysis(puuid, created_at)
        except asyncio.CancelledError:
            logger.info("Background analysis cancelled", puuid=puuid)
            # Rate limiter release and task cleanup happen in finally block
            raise
        except Exception as e:
            logger.error(
                "Background analysis failed", puuid=puuid, error=str(e), exc_info=True
            )
            try:
                async with db_manager.get_session() as db:
                    await db.execute(
                        update(MatchmakingAnalysis)
                        .where(
                            and_(
                                MatchmakingAnalysis.puuid == puuid,
                                MatchmakingAnalysis.created_at == created_at,
                            )
                        )
                        .values(
                            rate_limit_reset_at=None,
                            completed_at=datetime.now(timezone.utc),
                            results={
                                "team_avg_winrate": 0,
                                "enemy_avg_winrate": 0,
                                "matches_analyzed": 0,
                                "error": str(e)[:200],
                            },
                        )
                    )
                    await db.commit()
            except Exception:
                pass
        finally:
            _running_analyses.pop(puuid, None)
            if rate_limiter:
                try:
                    async with db_manager.get_session() as db:
                        rate_limiter.db = db
                        await rate_limiter.release()
                except Exception:
                    pass

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

        self.requests_saved = 0
        self.api_calls_made = 0
        self._current_analysis_puuid = puuid
        self._current_analysis_created_at = created_at
        self._winrate_cache = {}

        # Mark as started
        await self.db.execute(
            update(MatchmakingAnalysis)
            .where(
                and_(
                    MatchmakingAnalysis.puuid == puuid,
                    MatchmakingAnalysis.created_at == created_at,
                )
            )
            .values(started_at=datetime.now(timezone.utc))
        )
        await self.db.commit()

        try:
            # --- Step 1: Get current player's last 10 ranked match IDs ---
            # No endTime — we want the actual latest matches for the current player.
            # This is always 1 API call that cannot be skipped.
            spine_match_ids = await self._api_fetch_match_ids(
                puuid, count=self.MATCHES_TO_ANALYZE
            )
            if not spine_match_ids or len(spine_match_ids) < self.MIN_MATCHES_REQUIRED:
                await self._complete_with_error(
                    puuid,
                    created_at,
                    f"Not enough matches: found {len(spine_match_ids) if spine_match_ids else 0}, need {self.MIN_MATCHES_REQUIRED}",
                )
                return

            # --- Step 2: Ensure all spine matches are in DB ---
            spine_in_db_count = 0
            for mid in spine_match_ids:
                was_in_db = await self._ensure_match_in_db(mid)
                if was_in_db:
                    spine_in_db_count += 1

            # Verify current player is in the first match
            first_participants = await self._get_match_participants(spine_match_ids[0])
            if not any(p == puuid for p, _ in first_participants):
                await self._complete_with_error(
                    puuid, created_at, "Current player not in first match"
                )
                return

            logger.info(
                "Spine matches ready",
                puuid=puuid,
                count=len(spine_match_ids),
                in_db=spine_in_db_count,
            )

            # --- Step 3: Pre-populate progress keys ---
            all_keys = []
            for mid in spine_match_ids:
                participants = await self._get_match_participants(mid)
                for p_puuid, _ in participants:
                    all_keys.append(f"{p_puuid}:{mid}")

            initial_progress = {k: False for k in all_keys}
            await self._update_progress(puuid, created_at, initial_progress)
            logger.info("Progress initialized", puuid=puuid, total_keys=len(all_keys))

            # --- Step 4: Process each spine match with per-match anchor ---
            team_avgs: List[float] = []
            enemy_avgs: List[float] = []

            for idx, match_id in enumerate(spine_match_ids):
                # Get THIS match's timestamp as the anchor for this match
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
                    if result["team"]:
                        team_avgs.append(sum(result["team"]) / len(result["team"]))
                    if result["enemy"]:
                        enemy_avgs.append(sum(result["enemy"]) / len(result["enemy"]))

            # --- Step 5: Final averages ---
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

            results = {
                "team_avg_winrate": round(team_avg, 4),
                "enemy_avg_winrate": round(enemy_avg, 4),
                "matches_analyzed": expected_matches_analyzed,
                "players_analyzed": expected_players,
            }

            # Calculate requests saved:
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

            now = datetime.now(timezone.utc)
            await self.db.execute(
                update(MatchmakingAnalysis)
                .where(
                    and_(
                        MatchmakingAnalysis.puuid == puuid,
                        MatchmakingAnalysis.created_at == created_at,
                    )
                )
                .values(
                    results=results,
                    completed_at=now,
                    requests_saved=self.requests_saved,
                    rate_limit_reset_at=None,
                )
            )

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

        except Exception as e:
            logger.error("Analysis failed", puuid=puuid, error=str(e), exc_info=True)
            raise

    # ================================================================
    # Match Processing
    # ================================================================

    async def _process_match(
        self,
        analysis_puuid: str,
        analysis_created_at: datetime,
        match_id: str,
        end_time_seconds: int,
    ) -> Optional[Dict]:
        """Process a single spine match: compute winrates for all participants."""
        participants = await self._get_match_participants(match_id)
        if not participants:
            return None

        # Find the current player's team
        target_team = None
        for p_puuid, team_id in participants:
            if p_puuid == analysis_puuid:
                target_team = team_id
                break
        if target_team is None:
            logger.warning("Current player not in match", match_id=match_id)
            return None

        team_wrs: List[float] = []
        enemy_wrs: List[float] = []

        for p_puuid, team_id in participants:
            if p_puuid in self._winrate_cache:
                wr = self._winrate_cache[p_puuid]
            else:
                wr = await self._calculate_player_winrate(p_puuid, end_time_seconds)
                self._winrate_cache[p_puuid] = wr

                # Update progress
                analysis = await self._get_analysis(analysis_puuid, analysis_created_at)
                progress = analysis.puuid_progress or {}
                for key in list(progress.keys()):
                    if key.startswith(f"{p_puuid}:"):
                        progress[key] = True
                await self._update_progress(
                    analysis_puuid, analysis_created_at, progress
                )

            if wr is not None:
                if team_id == target_team:
                    team_wrs.append(wr)
                else:
                    enemy_wrs.append(wr)

        return {"team": team_wrs, "enemy": enemy_wrs}

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

        # DB-first check
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
            # DB shortcut - no API calls needed for this player
            win_count = sum(1 for (w,) in db_wins if w)
            return win_count / len(db_wins)

        # Fall back to API
        match_ids = await self._get_match_ids_for_player(puuid, end_time_seconds)
        if not match_ids:
            # Use whatever DB data we have
            if db_wins:
                win_count = sum(1 for (w,) in db_wins if w)
                return win_count / len(db_wins)
            return None

        wins = 0
        total = 0
        for mid in match_ids:
            win = await self._get_win_status(mid, puuid)
            if win is not None:
                total += 1
                if win:
                    wins += 1

        return wins / total if total > 0 else None

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
        dto = await self._api_fetch_match(match_id)
        if dto is None:
            return []
        from app.core.match_utils import _upsert_match

        await _upsert_match(self.db, dto)
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
        from app.core.match_utils import _upsert_match

        await _upsert_match(self.db, dto)

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
            from app.core.match_utils import _upsert_match

            await _upsert_match(self.db, dto)
        return False

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
    ) -> List[str]:
        """Fetch match IDs from Riot API with rate limit handling."""
        max_retries = 10
        for attempt in range(max_retries):
            try:
                if self.rate_limiter:
                    if not await self.rate_limiter.acquire_with_wait_callback(
                        wait_callback=self._rate_limit_wait_callback,
                    ):
                        logger.warning(
                            "Rate limit: cannot fetch match IDs", puuid=puuid
                        )
                        return []

                match_list = await self.riot_client.get_match_list_by_puuid(
                    puuid=puuid,
                    start=0,
                    count=count,
                    queue=420,
                    end_time=end_time,
                )

                if self.rate_limiter:
                    await self.rate_limiter.record_request()

                self.api_calls_made += 1
                await self._clear_rate_limit_wait_if_active()
                return match_list.match_ids

            except RateLimitError as e:
                retry_after = int(e.retry_after or 120)
                logger.info(
                    "Rate limit on match ID fetch",
                    puuid=puuid,
                    retry_after=retry_after,
                    attempt=attempt + 1,
                )
                await self._wait_for_rate_limit(retry_after)

            except RiotAPIError as e:
                logger.error("Failed to fetch match IDs", puuid=puuid, error=str(e))
                return []

        logger.warning("Max retries for match ID fetch", puuid=puuid)
        return []

    async def _api_fetch_match(self, match_id: str):
        """Fetch a single match from API. Returns MatchDTO or None."""
        max_retries = 10
        for attempt in range(max_retries):
            try:
                if self.rate_limiter:
                    if not await self.rate_limiter.acquire_with_wait_callback(
                        wait_callback=self._rate_limit_wait_callback,
                    ):
                        logger.warning(
                            "Rate limit: cannot fetch match", match_id=match_id
                        )
                        return None

                dto = await self.riot_client.get_match(match_id)

                if self.rate_limiter:
                    await self.rate_limiter.record_request()

                self.api_calls_made += 1
                await self._clear_rate_limit_wait_if_active()
                return dto

            except RateLimitError as e:
                retry_after = int(e.retry_after or 120)
                logger.info(
                    "Rate limit on match fetch",
                    match_id=match_id,
                    retry_after=retry_after,
                    attempt=attempt + 1,
                )
                await self._wait_for_rate_limit(retry_after)

            except RiotAPIError as e:
                logger.warning("Failed to fetch match", match_id=match_id, error=str(e))
                return None

        logger.warning("Max retries for match fetch", match_id=match_id)
        return None

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
        """Wait for rate limit reset, setting countdown timestamp for frontend."""
        wait_time = min(retry_after, MAX_RATE_LIMIT_WAIT)
        reset_at = datetime.now(timezone.utc) + timedelta(seconds=wait_time)

        logger.info("Waiting for rate limit", wait_seconds=wait_time, reset_at=reset_at)
        self._is_waiting_for_rate_limit = True
        await self._set_rate_limit_reset(reset_at)
        await asyncio.sleep(wait_time)

    async def _clear_rate_limit_wait_if_active(self) -> None:
        """Clear rate-limit countdown once requests can proceed again."""
        if not self._is_waiting_for_rate_limit:
            return
        self._is_waiting_for_rate_limit = False
        await self._set_rate_limit_reset(None, force_clear=True)

    async def _set_rate_limit_reset(
        self,
        reset_at: Optional[datetime],
        force_clear: bool = False,
    ) -> None:
        """Update rate_limit_reset_at in DB so frontend can show countdown."""
        if not self._current_analysis_puuid or not self._current_analysis_created_at:
            return
        try:
            result = await self.db.execute(
                select(MatchmakingAnalysis.rate_limit_reset_at).where(
                    and_(
                        MatchmakingAnalysis.puuid == self._current_analysis_puuid,
                        MatchmakingAnalysis.created_at
                        == self._current_analysis_created_at,
                    )
                )
            )
            current_reset = result.scalar_one_or_none()
            now = datetime.now(timezone.utc)

            next_reset = reset_at
            if reset_at is None and not force_clear:
                # Keep future reset time if another wait cycle is still active.
                if current_reset and current_reset > now:
                    next_reset = current_reset
            elif reset_at is not None and current_reset and current_reset > reset_at:
                # Keep the later reset time if one is already set
                next_reset = current_reset

            await self.db.execute(
                update(MatchmakingAnalysis)
                .where(
                    and_(
                        MatchmakingAnalysis.puuid == self._current_analysis_puuid,
                        MatchmakingAnalysis.created_at
                        == self._current_analysis_created_at,
                    )
                )
                .values(
                    rate_limit_reset_at=next_reset, requests_saved=self.requests_saved
                )
            )
            await self.db.commit()
        except Exception as e:
            logger.warning("Failed to set rate_limit_reset_at", error=str(e))
            try:
                await self.db.rollback()
            except Exception:
                pass

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
                )
            )
        )
        return result.scalar_one()

    async def _update_progress(
        self, puuid: str, created_at: datetime, progress: Dict[str, bool]
    ) -> None:
        await self.db.execute(
            update(MatchmakingAnalysis)
            .where(
                and_(
                    MatchmakingAnalysis.puuid == puuid,
                    MatchmakingAnalysis.created_at == created_at,
                )
            )
            .values(puuid_progress=progress)
        )
        await self.db.commit()

    async def _complete_with_error(
        self, puuid: str, created_at: datetime, msg: str
    ) -> None:
        logger.warning("Analysis error", puuid=puuid, error=msg)
        await self.db.execute(
            update(MatchmakingAnalysis)
            .where(
                and_(
                    MatchmakingAnalysis.puuid == puuid,
                    MatchmakingAnalysis.created_at == created_at,
                )
            )
            .values(
                completed_at=datetime.now(timezone.utc),
                results={
                    "team_avg_winrate": 0,
                    "enemy_avg_winrate": 0,
                    "matches_analyzed": 0,
                    "error": msg,
                },
                rate_limit_reset_at=None,
            )
        )
        await self.db.commit()
