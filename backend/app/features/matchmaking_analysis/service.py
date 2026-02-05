"""Matchmaking analysis service for analyzing League of Legends matchmaking fairness.

This service calculates the average winrate of players on your team vs enemies
across your last 10 ranked matches. For each of the ~100 players in those matches,
it fetches their last 10 matches to calculate their winrate.

Total API calls in worst case: ~1100 (1 + 10*10 + 10*10*10)
- 1 to get player's match IDs
- 100 to get match details (10 matches * 10 players)
- 1000 to get each player's match history (10 matches * 10 players * 10 matches)

Progress is tracked in puuid_progress JSONB column to enable resumption.

Rate Limiting:
- Uses DBRateLimiter with lowest priority (3) to yield to jobs
- Will wait up to 30 minutes for rate limit window resets
- Coordinates with Match Fetcher and Player Updater via database
- When 429 errors occur, waits for Retry-After and retries
"""

import asyncio
from typing import Optional, List, Dict, Tuple
from datetime import datetime, timezone
import structlog

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, and_
from sqlalchemy.dialects.postgresql import insert

from .models import MatchmakingAnalysis
from app.features.matches.models import Match
from app.features.matches.participants import MatchParticipant
from .schemas import (
    MatchmakingAnalysisResponse,
    MatchmakingAnalysisStatusResponse,
    MatchmakingAnalysisHistoryItem,
    MatchmakingAnalysisHistoryResponse,
)
from app.core.riot_api.client import RiotAPIClient
from app.core.riot_api.errors import RiotAPIError, RateLimitError
from app.core.riot_api.db_rate_limiter import DBRateLimiter, RateLimitComponent
from app.core.riot_api.transformers import MatchTransformer
from app.core import db_manager

logger = structlog.get_logger(__name__)

# Maximum wait time for a single rate limit reset (120 seconds = 2 minutes)
MAX_RATE_LIMIT_WAIT = 120

# Global registry to track running analyses
_running_analyses: Dict[str, asyncio.Task] = {}


class MatchmakingAnalysisService:
    """Service for analyzing matchmaking fairness."""

    # Constants
    MATCHES_TO_ANALYZE = 10
    MATCHES_FOR_WINRATE = 10
    MIN_MATCHES_REQUIRED = 10
    EXPECTED_PLAYERS = 100  # 10 matches * 10 players per match

    def __init__(self, db: AsyncSession, riot_client: RiotAPIClient):
        """Initialize matchmaking analysis service."""
        self.db = db
        self.riot_client = riot_client
        self.transformer = MatchTransformer()
        self.rate_limiter: Optional[DBRateLimiter] = None
        self.requests_saved: int = 0  # Track saved API calls
        self._current_analysis_puuid: Optional[str] = None  # For updating wait status
        self._current_analysis_created_at: Optional[datetime] = None

    async def check_player_has_enough_matches(self, puuid: str) -> Tuple[bool, int]:
        """
        Check if player has at least 10 ranked matches.

        Returns:
            Tuple of (has_enough, match_count)
        """
        try:
            match_list = await self.riot_client.get_match_list_by_puuid(
                puuid=puuid,
                start=0,
                count=self.MIN_MATCHES_REQUIRED,
                queue=420,  # Ranked Solo/Duo only
            )
            match_count = len(match_list.match_ids)
            return match_count >= self.MIN_MATCHES_REQUIRED, match_count
        except RiotAPIError as e:
            logger.error(
                "Failed to check player match count", puuid=puuid, error=str(e)
            )
            raise

    async def start_analysis(self, puuid: str) -> MatchmakingAnalysisResponse:
        """
        Start a new matchmaking analysis for a player.

        This creates a new analysis record and spawns a background task
        to perform the analysis. The task runs independently of the request.
        """
        # Clean up completed/cancelled tasks from registry
        if puuid in _running_analyses:
            task = _running_analyses[puuid]
            if task.done():
                # Task finished (completed, failed, or cancelled) - remove it
                _running_analyses.pop(puuid, None)
            else:
                # Task is still running
                logger.info("Analysis already running for player", puuid=puuid)
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
            logger.info(
                "Found existing in-progress analysis, resuming",
                puuid=puuid,
                created_at=existing.created_at,
            )
            # Resume the existing analysis
            task = asyncio.create_task(
                self._run_analysis_background(puuid, existing.created_at)
            )
            _running_analyses[puuid] = task
            return MatchmakingAnalysisResponse.model_validate(existing)

        # Create new analysis record
        now = datetime.now(timezone.utc)
        analysis = MatchmakingAnalysis(
            puuid=puuid,
            created_at=now,
            puuid_progress={},
        )

        self.db.add(analysis)
        await self.db.commit()
        await self.db.refresh(analysis)

        logger.info("Created new matchmaking analysis", puuid=puuid, created_at=now)

        # Start background task
        task = asyncio.create_task(self._run_analysis_background(puuid, now))
        _running_analyses[puuid] = task

        return MatchmakingAnalysisResponse.model_validate(analysis)

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

        # Build status response
        puuid_progress = analysis.puuid_progress or {}
        progress = sum(1 for v in puuid_progress.values() if v)
        total = len(puuid_progress)

        status = "pending"
        if analysis.completed_at:
            status = "completed"
        elif analysis.started_at:
            status = "in_progress"

        # Convert dict results to schema if present
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
        for analysis in analyses:
            if analysis.results:
                items.append(
                    MatchmakingAnalysisHistoryItem(
                        created_at=analysis.created_at,
                        team_avg_winrate=analysis.results.get("team_avg_winrate", 0),
                        enemy_avg_winrate=analysis.results.get("enemy_avg_winrate", 0),
                    )
                )

        return MatchmakingAnalysisHistoryResponse(items=items)

    async def _run_analysis_background(self, puuid: str, created_at: datetime) -> None:
        """
        Run the matchmaking analysis in the background.

        This method creates its own DB session and runs independently.
        Uses DB rate limiter with lowest priority to coordinate with other components.
        """
        rate_limiter = None
        try:
            async with db_manager.get_session() as db:
                from app.core.config import get_riot_api_key

                api_key = await get_riot_api_key(db)

                async with RiotAPIClient(api_key=api_key) as riot_client:
                    # Initialize rate limiter with lowest priority
                    rate_limiter = DBRateLimiter(
                        db, RateLimitComponent.MATCHMAKING_ANALYSIS
                    )

                    service = MatchmakingAnalysisService(db, riot_client)
                    service.rate_limiter = rate_limiter
                    await service._run_analysis(puuid, created_at)
        except Exception as e:
            logger.error(
                "Background analysis failed",
                puuid=puuid,
                error=str(e),
                exc_info=True,
            )
        finally:
            # Clean up from running analyses
            _running_analyses.pop(puuid, None)
            # Release rate limiter
            if rate_limiter:
                try:
                    async with db_manager.get_session() as db:
                        rate_limiter.db = db
                        await rate_limiter.release()
                except Exception:
                    pass  # Best effort cleanup

    async def _run_analysis(self, puuid: str, created_at: datetime) -> None:
        """
        Run the matchmaking analysis.

        Workflow:
        1. Get player's last 10 matches
        2. Pre-populate puuid_progress with all participants (100 unique PUUIDs)
        3. For each participant, calculate their winrate from last 10 matches
        4. Average win rates for teammates vs enemies
        """
        logger.info("Starting matchmaking analysis", puuid=puuid, created_at=created_at)

        # Reset requests_saved counter and set current analysis context
        self.requests_saved = 0
        self._current_analysis_puuid = puuid
        self._current_analysis_created_at = created_at

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
            # Step 1: Get player's last 10 matches
            match_ids = await self._fetch_player_matches(puuid, self.MATCHES_TO_ANALYZE)

            if len(match_ids) < self.MIN_MATCHES_REQUIRED:
                logger.warning(
                    "Not enough matches for analysis",
                    puuid=puuid,
                    found=len(match_ids),
                    required=self.MIN_MATCHES_REQUIRED,
                )
                return

            logger.info("Fetched player matches", puuid=puuid, count=len(match_ids))

            # Step 1b: Pre-populate puuid_progress with all participant:timestamp keys
            all_keys = await self._collect_all_participant_keys(match_ids)
            initial_progress = {k: False for k in all_keys}
            await self._update_puuid_progress(puuid, created_at, initial_progress)
            logger.info(
                "Pre-populated progress with all participant keys",
                puuid=puuid,
                total_keys=len(all_keys),
            )

            # Step 2: Process each match and collect winrates
            team_winrates: List[float] = []
            enemy_winrates: List[float] = []

            for match_idx, match_id in enumerate(match_ids):
                logger.info(
                    f"Processing match {match_idx + 1}/{len(match_ids)}",
                    match_id=match_id,
                )

                match_result = await self._process_match(
                    puuid, created_at, match_id, puuid
                )

                if match_result:
                    team_winrates.extend(match_result["team_winrates"])
                    enemy_winrates.extend(match_result["enemy_winrates"])

            # Step 3: Calculate final results
            team_avg = sum(team_winrates) / len(team_winrates) if team_winrates else 0.0
            enemy_avg = (
                sum(enemy_winrates) / len(enemy_winrates) if enemy_winrates else 0.0
            )

            # matches_analyzed = player's 10 matches
            # players_analyzed = team (50) + enemy (50) = 100 winrate samples
            # (some players appear in multiple matches, so unique count may be ~91)
            results = {
                "team_avg_winrate": round(team_avg, 4),
                "enemy_avg_winrate": round(enemy_avg, 4),
                "matches_analyzed": len(match_ids),
                "players_analyzed": len(team_winrates) + len(enemy_winrates),
            }

            # Step 4: Save results with requests_saved
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
                    rate_limit_wait_seconds=0,  # Clear wait indicator
                )
            )

            # Step 5: Update player's last_matchmaking_analysis timestamp
            from app.features.players.models import Player

            await self.db.execute(
                update(Player)
                .where(Player.puuid == puuid)
                .values(last_matchmaking_analysis=now)
            )
            await self.db.commit()

            logger.info(
                "Matchmaking analysis completed",
                puuid=puuid,
                results=results,
                requests_saved=self.requests_saved,
            )

        except Exception as e:
            logger.error(
                "Matchmaking analysis failed",
                puuid=puuid,
                error=str(e),
                exc_info=True,
            )
            raise

    async def _fetch_player_matches(self, puuid: str, count: int) -> List[str]:
        """Fetch player's last N match IDs from API."""
        try:
            # Acquire rate limit before API call
            if self.rate_limiter:
                can_proceed = await self.rate_limiter.acquire()
                if not can_proceed:
                    logger.warning(
                        "Rate limit exceeded, cannot fetch player matches",
                        puuid=puuid,
                    )
                    return []

            match_list = await self.riot_client.get_match_list_by_puuid(
                puuid=puuid,
                start=0,
                count=count,
                queue=420,  # Ranked Solo/Duo only
            )

            # Record the request
            if self.rate_limiter:
                await self.rate_limiter.record_request()

            return match_list.match_ids
        except RiotAPIError as e:
            logger.error("Failed to fetch player matches", puuid=puuid, error=str(e))
            raise

    async def _collect_all_participant_keys(self, match_ids: List[str]) -> List[str]:
        """
        Collect all participant progress keys from a list of matches.
        Each key is in format 'puuid:timestamp' to track winrate calculation
        per participant per match (since same player may appear in multiple matches).

        Returns list of progress keys (100 for 10 matches - one per participant per match).
        """
        all_keys: List[str] = []

        for match_id in match_ids:
            participants = await self._get_match_participants(match_id)
            match_start_timestamp = await self._get_match_start_timestamp(match_id)

            if match_start_timestamp is None:
                continue

            for participant_puuid, _ in participants:
                key = f"{participant_puuid}:{match_start_timestamp}"
                all_keys.append(key)

        return all_keys

    async def _process_match(
        self,
        analysis_puuid: str,
        analysis_created_at: datetime,
        match_id: str,
        target_puuid: str,
    ) -> Optional[Dict]:
        """
        Process a single match and collect winrates for all participants.

        For each participant, we calculate their winrate based on their
        last 10 ranked matches starting at or before this match's start time.
        This includes the match itself + their 9 previous matches.

        Returns dict with team_winrates and enemy_winrates lists.
        """
        # Get match participants and match start timestamp
        participants = await self._get_match_participants(match_id)

        if not participants:
            logger.warning("No participants found for match", match_id=match_id)
            return None

        # Get match start timestamp for historical winrate lookup
        match_start_timestamp = await self._get_match_start_timestamp(match_id)
        if match_start_timestamp is None:
            logger.warning("Could not get match start timestamp", match_id=match_id)
            return None

        # Find target player's team
        target_team_id = None
        for participant_puuid, team_id in participants:
            if participant_puuid == target_puuid:
                target_team_id = team_id
                break

        if target_team_id is None:
            logger.warning(
                "Target player not found in match",
                match_id=match_id,
                target_puuid=target_puuid,
            )
            return None

        team_winrates: List[float] = []
        enemy_winrates: List[float] = []

        # Process each participant
        for participant_puuid, team_id in participants:
            # Check if already analyzed for THIS specific match start timestamp
            # Note: Same puuid may appear in multiple matches with different timestamps
            # We use a composite key of puuid:start_timestamp for caching
            analysis = await self._get_current_analysis(
                analysis_puuid, analysis_created_at
            )
            puuid_progress = analysis.puuid_progress or {}
            progress_key = f"{participant_puuid}:{match_start_timestamp}"

            if progress_key in puuid_progress and puuid_progress[progress_key]:
                # Already analyzed for this timestamp, get cached winrate
                winrate = await self._get_cached_winrate(
                    participant_puuid, match_start_timestamp
                )
            else:
                # Need to analyze this player at this point in time
                winrate = await self._calculate_participant_winrate(
                    participant_puuid, match_start_timestamp
                )

                # Update progress with composite key
                puuid_progress[progress_key] = True
                await self._update_puuid_progress(
                    analysis_puuid, analysis_created_at, puuid_progress
                )

            if winrate is not None:
                if team_id == target_team_id:
                    team_winrates.append(winrate)
                else:
                    enemy_winrates.append(winrate)

        return {
            "team_winrates": team_winrates,
            "enemy_winrates": enemy_winrates,
        }

    async def _get_current_analysis(
        self, puuid: str, created_at: datetime
    ) -> MatchmakingAnalysis:
        """Get the current analysis record."""
        result = await self.db.execute(
            select(MatchmakingAnalysis).where(
                and_(
                    MatchmakingAnalysis.puuid == puuid,
                    MatchmakingAnalysis.created_at == created_at,
                )
            )
        )
        return result.scalar_one()

    async def _update_puuid_progress(
        self, puuid: str, created_at: datetime, progress: Dict[str, bool]
    ) -> None:
        """Update the puuid_progress for an analysis."""
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

    async def _update_wait_seconds(self, wait_seconds: int) -> None:
        """Update the rate_limit_wait_seconds for the current analysis."""
        if self._current_analysis_puuid and self._current_analysis_created_at:
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
                    rate_limit_wait_seconds=wait_seconds,
                    requests_saved=self.requests_saved,
                )
            )
            await self.db.commit()

    async def _wait_for_rate_limit_with_countdown(self, retry_after: int) -> None:
        """
        Wait for rate limit to reset with countdown updates to the database.
        Updates the rate_limit_wait_seconds column every second so frontend can show countdown.
        """
        wait_time = min(retry_after, MAX_RATE_LIMIT_WAIT)
        logger.info(
            "Waiting for rate limit to reset",
            wait_seconds=wait_time,
        )

        remaining = wait_time
        while remaining > 0:
            await self._update_wait_seconds(remaining)
            await asyncio.sleep(1)
            remaining -= 1

        # Clear the wait indicator
        await self._update_wait_seconds(0)

    async def _get_match_start_timestamp(self, match_id: str) -> Optional[int]:
        """
        Get the game_start_timestamp for a match from the database.

        This is used as the reference point for fetching a participant's
        "last 10 matches at the time of this match". Using game_start_timestamp
        is correct because Riot API's endTime parameter filters by gameCreation
        (match start time), not gameEndTimestamp.

        Returns:
            Epoch timestamp in milliseconds, or None if match not found
        """
        result = await self.db.execute(
            select(Match.game_start_timestamp).where(Match.match_id == match_id)
        )
        return result.scalar_one_or_none()

    async def _get_match_participants(self, match_id: str) -> List[Tuple[str, int]]:
        """
        Get list of (puuid, team_id) tuples for a match.
        Checks DB first, fetches from API if not found.
        """
        # Check database first
        result = await self.db.execute(
            select(MatchParticipant.puuid, MatchParticipant.team_id).where(
                MatchParticipant.match_id == match_id
            )
        )
        participants = result.all()

        if participants:
            return [(p.puuid, p.team_id) for p in participants]

        # Not in DB, fetch from API
        logger.info("Fetching match from API", match_id=match_id)

        try:
            # Acquire rate limit before API call
            if self.rate_limiter:
                can_proceed = await self.rate_limiter.acquire()
                if not can_proceed:
                    logger.warning(
                        "Rate limit exceeded, cannot fetch match",
                        match_id=match_id,
                    )
                    return []

            match_dto = await self.riot_client.get_match(match_id)

            # Record the request
            if self.rate_limiter:
                await self.rate_limiter.record_request()

            await self._store_match(match_dto)

            return [(p.puuid, p.team_id) for p in match_dto.info.participants]
        except RiotAPIError as e:
            logger.error("Failed to fetch match", match_id=match_id, error=str(e))
            return []

    async def _store_match(self, match_dto) -> None:
        """Store match and participants in database."""
        try:
            match_data_dict = {
                "metadata": {"matchId": match_dto.metadata.match_id},
                "info": {
                    "platformId": match_dto.info.platform,
                    "gameCreation": match_dto.info.game_start_timestamp,
                    "gameDuration": match_dto.info.game_duration,
                    "queueId": match_dto.info.queue_id,
                    "gameVersion": match_dto.info.game_version,
                    "mapId": match_dto.info.map_id,
                    "gameMode": match_dto.info.game_mode,
                    "gameType": match_dto.info.game_type,
                    "gameEndTimestamp": match_dto.info.game_end_timestamp,
                    "endOfGameResult": match_dto.info.game_result,
                    "participants": [
                        {
                            "puuid": p.puuid,
                            "gameName": p.game_name,
                            "tagLine": p.tag_line,
                            "teamId": p.team_id,
                            "championId": p.champion_id,
                            "championName": p.champion_name,
                            "kills": p.kills,
                            "deaths": p.deaths,
                            "assists": p.assists,
                            "win": p.win,
                            "goldEarned": p.gold_earned,
                            "visionScore": p.vision_score,
                            "totalMinionsKilled": getattr(p, "total_minions_killed", 0),
                            "neutralMinionsKilled": getattr(
                                p, "neutral_minions_killed", 0
                            ),
                            "champLevel": p.champion_level,
                            "totalDamageDealt": p.total_damage_dealt,
                            "totalDamageDealtToChampions": p.total_damage_dealt_to_champions,
                            "damageTaken": p.total_damage_taken,
                            "totalHeal": p.total_self_healing,
                            "individualPosition": p.individual_position,
                            "teamPosition": p.team_position,
                            "role": p.role,
                        }
                        for p in match_dto.info.participants
                    ],
                },
            }

            transformed = self.transformer.transform_match_data(match_data_dict)

            # Upsert match
            match_stmt = (
                insert(Match)
                .values(**transformed["match"])
                .on_conflict_do_nothing(index_elements=["match_id"])
            )
            await self.db.execute(match_stmt)

            # Upsert participants
            for participant_dict in transformed["participants"]:
                participant_stmt = (
                    insert(MatchParticipant)
                    .values(**participant_dict)
                    .on_conflict_do_nothing(index_elements=["match_id", "puuid"])
                )
                await self.db.execute(participant_stmt)

            await self.db.commit()

        except Exception as e:
            logger.error(
                "Failed to store match",
                match_id=match_dto.metadata.match_id,
                error=str(e),
            )
            await self.db.rollback()

    async def _get_cached_winrate(
        self, puuid: str, end_timestamp: int
    ) -> Optional[float]:
        """
        Get winrate from cached matches in DB that ended at or before the given timestamp.

        Args:
            puuid: Player's PUUID
            end_timestamp: Epoch timestamp in milliseconds - include matches that ended <= this
        """
        result = await self.db.execute(
            select(MatchParticipant.win)
            .join(Match, MatchParticipant.match_id == Match.match_id)
            .where(
                MatchParticipant.puuid == puuid,
                Match.queue_id == 420,
                Match.game_end_timestamp <= end_timestamp,
            )
            .order_by(Match.game_end_timestamp.desc())
            .limit(self.MATCHES_FOR_WINRATE)
        )
        wins = result.all()

        if not wins:
            return None

        win_count = sum(1 for (win,) in wins if win)
        return win_count / len(wins) if wins else None

    async def _calculate_participant_winrate(
        self, puuid: str, end_timestamp: int
    ) -> Optional[float]:
        """
        Calculate winrate for a participant from their last N matches starting at or before the timestamp.

        This is crucial for accurate matchmaking analysis:
        - We want the player's winrate INCLUDING the match with the current player
        - Using endTime = game_start_timestamp ensures we get that match + 9 previous
        - Riot API's endTime parameter filters by gameCreation (start time), not end time
        - This represents "their last 10 matches at the time they played with you"

        Args:
            puuid: Player's PUUID
            end_timestamp: Epoch timestamp in milliseconds (game_start_timestamp of reference match)

        Returns:
            Winrate as float (0.0-1.0), or None if no matches found
        """
        # Convert milliseconds to seconds for API (Riot uses epoch seconds for endTime)
        end_time_seconds = end_timestamp // 1000

        # First check if we already have enough matches in DB at or before this timestamp
        result = await self.db.execute(
            select(MatchParticipant.win)
            .join(Match, MatchParticipant.match_id == Match.match_id)
            .where(
                MatchParticipant.puuid == puuid,
                Match.queue_id == 420,
                Match.game_start_timestamp <= end_timestamp,
            )
            .order_by(Match.game_start_timestamp.desc())
            .limit(self.MATCHES_FOR_WINRATE)
        )
        db_matches = result.all()

        if len(db_matches) >= self.MATCHES_FOR_WINRATE:
            # We have enough cached data - saved 11 requests (1 match list + 10 matches)
            self.requests_saved += 11
            win_count = sum(1 for (win,) in db_matches if win)
            return win_count / len(db_matches)

        cached_winrate = None
        if db_matches:
            win_count = sum(1 for (win,) in db_matches if win)
            cached_winrate = win_count / len(db_matches)

        # Need to fetch from API using endTime to get historical matches
        max_rate_limit_retries = (
            15  # Allow up to 15 rate limit waits (30+ minutes total)
        )
        rate_limit_retries = 0

        while rate_limit_retries < max_rate_limit_retries:
            try:
                # Use endTime to only get matches that started BEFORE the reference match
                match_list = await self.riot_client.get_match_list_by_puuid(
                    puuid=puuid,
                    start=0,
                    count=self.MATCHES_FOR_WINRATE,
                    queue=420,
                    end_time=end_time_seconds,
                )

                if not match_list.match_ids:
                    return cached_winrate

                wins = 0
                total = 0

                for match_id in match_list.match_ids:
                    win_status = await self._get_or_fetch_match_win_status(
                        match_id, puuid
                    )

                    if win_status is not None:
                        total += 1
                        if win_status:
                            wins += 1

                return wins / total if total > 0 else cached_winrate

            except RateLimitError as e:
                rate_limit_retries += 1
                retry_after = int(
                    e.retry_after or 120
                )  # Default to 120s if not specified
                logger.info(
                    "Rate limit hit, waiting before retry",
                    puuid=puuid,
                    end_timestamp=end_timestamp,
                    retry_after=retry_after,
                    attempt=rate_limit_retries,
                )
                await self._wait_for_rate_limit_with_countdown(retry_after)
                # Continue to retry

            except RiotAPIError as e:
                logger.warning(
                    "Failed to fetch participant matches",
                    puuid=puuid,
                    error=str(e),
                )
                return cached_winrate

        logger.warning(
            "Max rate limit retries exceeded",
            puuid=puuid,
            retries=rate_limit_retries,
        )
        return cached_winrate

    async def _get_or_fetch_match_win_status(
        self, match_id: str, puuid: str
    ) -> Optional[bool]:
        """
        Get win status for a player in a match.
        Checks DB first, fetches from API if needed.
        Handles rate limits by waiting and retrying.
        """
        # Check if match exists in DB
        result = await self.db.execute(
            select(Match.match_id).where(Match.match_id == match_id)
        )
        match_exists = result.scalar_one_or_none() is not None

        if match_exists:
            # Match is in DB - get the participant's win status from DB
            self.requests_saved += 1
            result = await self.db.execute(
                select(MatchParticipant.win).where(
                    MatchParticipant.match_id == match_id,
                    MatchParticipant.puuid == puuid,
                )
            )
            return result.scalar_one_or_none()

        # Need to fetch match from API with rate limit handling
        max_retries = 10
        for attempt in range(max_retries):
            try:
                match_dto = await self.riot_client.get_match(match_id)
                await self._store_match(match_dto)

                # Find participant's win status
                for p in match_dto.info.participants:
                    if p.puuid == puuid:
                        return p.win
                return None

            except RateLimitError as e:
                retry_after = int(e.retry_after or 120)
                logger.info(
                    "Rate limit hit during match fetch, waiting",
                    match_id=match_id,
                    retry_after=retry_after,
                    attempt=attempt + 1,
                )
                await self._wait_for_rate_limit_with_countdown(retry_after)
                # Continue to retry

            except RiotAPIError as e:
                logger.warning(
                    "Failed to fetch match",
                    match_id=match_id,
                    error=str(e),
                )
                return None

        logger.warning(
            "Max retries exceeded for match fetch",
            match_id=match_id,
        )
        return None
