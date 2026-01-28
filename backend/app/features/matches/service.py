"""Match service for handling match data operations."""

from typing import Optional, List, Dict, Any, TYPE_CHECKING
import structlog

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc

from .models import Match
from .participants import MatchParticipant
from app.features.players.models import Player
from .schemas import (
    MatchResponse,
    MatchListResponse,
    MatchStatsResponse,
)
from app.core.riot_api.transformers import MatchTransformer
from app.core.riot_api.errors import (
    RiotAPIError,
    RateLimitError,
    AuthenticationError,
    ForbiddenError,
    NotFoundError,
)

if TYPE_CHECKING:
    from app.core.riot_api.client import RiotAPIClient

logger = structlog.get_logger(__name__)


class MatchService:
    """Service for handling match data operations."""

    def __init__(self, db: AsyncSession):
        """Initialize match service with database session only."""
        self.db = db
        self.transformer = MatchTransformer()

    async def get_player_matches(
        self,
        puuid: str,
        start: int = 0,
        count: int = 20,
        queue: Optional[int] = None,
        start_time: Optional[int] = None,
        end_time: Optional[int] = None,
    ) -> MatchListResponse:
        """
        Get match history for a player from database only.

        Never calls Riot API - returns whatever matches are available in database.
        Supports pagination for infinite scroll.

        Args:
            puuid: Player PUUID
            start: Start index for pagination
            count: Number of matches to return
            queue: Filter by queue ID
            start_time: Start timestamp
            end_time: End timestamp

        Returns:
            MatchListResponse with matches from database
        """
        try:
            # Get matches from database only
            db_matches = await self._get_matches_from_db(
                puuid, start, count, queue, start_time, end_time
            )

            # Get total count of matches for pagination
            total_count = await self._count_matches_from_db(
                puuid, queue, start_time, end_time
            )

            # Get total analyzed matches count
            total_analyzed = await self._count_analyzed_matches_from_db(
                puuid, queue, start_time, end_time
            )

            match_responses = [
                MatchResponse.model_validate(match) for match in db_matches
            ]

            # Calculate page-based pagination from start/count
            page = (start // count) if count > 0 else 0
            size = count
            pages = ((total_count + count - 1) // count) if count > 0 else 0

            logger.debug(
                "Retrieved matches from database",
                puuid=puuid,
                matches_count=len(match_responses),
                total_count=total_count,
                total_analyzed=total_analyzed,
                page=page,
                size=size,
            )

            return MatchListResponse(
                matches=match_responses,
                total=total_count,
                total_analyzed=total_analyzed,
                page=page,
                size=size,
                pages=pages,
            )
        except Exception as e:
            logger.error(
                "Failed to get player matches from database", puuid=puuid, error=str(e)
            )
            raise

    @staticmethod
    def _create_empty_stats_response(puuid: str) -> MatchStatsResponse:
        """Create stats response for players with no matches."""
        return MatchStatsResponse(
            puuid=puuid,
            total_matches=0,
            wins=0,
            losses=0,
            win_rate=0.0,
            avg_kills=0.0,
            avg_deaths=0.0,
            avg_assists=0.0,
            avg_kda=0.0,
            avg_cs=0.0,
            avg_vision_score=0.0,
        )

    @staticmethod
    def _aggregate_participant_stats(
        matches: list, participants_by_match: dict
    ) -> tuple[int, int, int, int, int, int]:
        """
        Aggregate statistics from match participants.

        Returns:
            Tuple of (kills, deaths, assists, cs, vision, wins)
        """
        totals = {
            "kills": 0,
            "deaths": 0,
            "assists": 0,
            "cs": 0,
            "vision": 0,
            "wins": 0,
        }

        for match in matches:
            participant = participants_by_match.get(match.match_id)
            if participant:
                totals["kills"] += participant.kills
                totals["deaths"] += participant.deaths
                totals["assists"] += participant.assists
                totals["cs"] += participant.cs
                totals["vision"] += participant.vision_score
                if participant.win:
                    totals["wins"] += 1

        return (
            totals["kills"],
            totals["deaths"],
            totals["assists"],
            totals["cs"],
            totals["vision"],
            totals["wins"],
        )

    async def get_player_stats(
        self, puuid: str, queue: Optional[int] = None, limit: int = 50
    ) -> MatchStatsResponse:
        """
        Calculate player statistics from recent matches.

        Args:
            puuid: Player PUUID
            queue: Filter by queue ID
            limit: Number of matches to analyze

        Returns:
            MatchStatsResponse with player statistics
        """
        try:
            # Get recent matches for the player
            matches = await self.get_player_matches(puuid, count=limit, queue=queue)

            if not matches.matches:
                return self._create_empty_stats_response(puuid)

            # Get all participants for these matches at once (fixes N+1 query problem)
            match_ids = [m.match_id for m in matches.matches]
            participants_stmt = select(MatchParticipant).where(
                MatchParticipant.match_id.in_(match_ids),
                MatchParticipant.puuid == puuid,
            )
            participants_result = await self.db.execute(participants_stmt)
            participants_by_match = {
                p.match_id: p for p in participants_result.scalars().all()
            }

            # Aggregate statistics
            total_kills, total_deaths, total_assists, total_cs, total_vision, wins = (
                self._aggregate_participant_stats(
                    matches.matches, participants_by_match
                )
            )

            total_matches = len(matches.matches)
            avg_kda = self._calculate_kda(total_kills, total_deaths, total_assists)

            # total_matches is guaranteed > 0 (checked for empty matches above)
            return MatchStatsResponse(
                puuid=puuid,
                total_matches=total_matches,
                wins=wins,
                losses=total_matches - wins,
                win_rate=wins / total_matches,
                avg_kills=total_kills / total_matches,
                avg_deaths=total_deaths / total_matches,
                avg_assists=total_assists / total_matches,
                avg_kda=avg_kda,
                avg_cs=total_cs / total_matches,
                avg_vision_score=total_vision / total_matches,
            )
        except Exception as e:
            logger.error("Failed to get player stats", puuid=puuid, error=str(e))
            raise

    async def fetch_player_matches(
        self,
        riot_api_client: Any,
        puuid: str,
        count: int = 20,
        queue: Optional[int] = None,
    ) -> int:
        """
        Fetch new matches for a player from Riot API and store them.

        Args:
            riot_api_client: Initialized Riot API client
            puuid: Player PUUID
            count: Number of matches to fetch
            queue: Optional queue filter

        Returns:
            Number of new matches stored
        """
        try:
            # Fetch match IDs (always fetch enough to find new ones)
            fetch_count = max(count, 50)
            match_ids = await self._fetch_match_ids_from_api(
                riot_api_client, puuid, queue
            )

            if not match_ids:
                return 0

            # Filter existing
            new_match_ids = await self._get_new_match_ids(match_ids)
            if not new_match_ids:
                return 0

            # Limit to requested count
            new_match_ids = new_match_ids[:count]

            logger.info(
                "Fetching new matches details",
                puuid=puuid,
                count=len(new_match_ids),
            )

            # Fetch and store details for each
            stored_count = 0
            for match_id in new_match_ids:
                try:
                    success = await self._fetch_and_store_single_match(
                        riot_api_client, match_id
                    )
                    if success:
                        stored_count += 1
                except Exception as e:
                    logger.error(
                        "Failed to process match during fetch",
                        match_id=match_id,
                        error=str(e),
                    )
                    # Continue with next match

            return stored_count

        except Exception as e:
            logger.error("Failed to fetch player matches", puuid=puuid, error=str(e))
            # Don't raise, just return 0 to allow partial success or graceful fallback
            return 0

    async def _fetch_match_ids_from_api(
        self, riot_api_client, puuid: str, queue: int
    ) -> list[str]:
        """
        Fetch match IDs from Riot API with error handling.

        Raises:
            RateLimitError, NotFoundError: API errors that should propagate
        """
        try:
            match_list = await riot_api_client.get_match_list_by_puuid(
                puuid=puuid, queue=queue, start=0, count=100
            )
            match_ids = (
                list(match_list.match_ids)
                if match_list and match_list.match_ids
                else []
            )

            logger.debug(
                "Fetched match IDs from Riot API",
                puuid=puuid,
                queue=queue,
                api_returned_count=len(match_ids),
                start=0,
                requested_count=100,
            )

            return match_ids
        except NotFoundError as e:
            logger.warning(
                "Player not found in Riot API",
                puuid=puuid,
                error=str(e),
            )
            return []  # Return empty list for not found players
        except RateLimitError as e:
            logger.warning(
                "Rate limit hit while fetching match list",
                puuid=puuid,
                retry_after=getattr(e, "retry_after", None),
            )
            raise  # Let job handler convert to RateLimitSignal
        except (AuthenticationError, ForbiddenError) as e:
            logger.error(
                "Authentication error fetching match list - cannot continue",
                puuid=puuid,
                error=str(e),
                status_code=e.status_code,
            )
            raise  # Always fail immediately on auth errors

    async def _get_new_match_ids(self, all_match_ids: list[str]) -> list[str]:
        """Filter match IDs to only those not in database."""
        if not all_match_ids:
            return []

        existing_stmt = select(Match.match_id).where(Match.match_id.in_(all_match_ids))
        existing_result = await self.db.execute(existing_stmt)
        existing_match_ids = set(existing_result.scalars().all())

        return [mid for mid in all_match_ids if mid not in existing_match_ids]

    async def _fetch_and_store_single_match(
        self, riot_api_client, match_id: str
    ) -> bool:
        """
        Fetch and store a single match.

        Returns:
            True if successfully stored, False otherwise

        Raises:
            RateLimitError: If rate limit is hit (should stop processing)
        """
        try:
            match_dto = await riot_api_client.get_match(match_id)
            if match_dto:
                # Use new storage method via DTO directly
                await self.store_match_from_dto(match_dto)
                # Commit is required as store_match_from_dto doesn't commit
                await self.db.commit()
                return True
            return False
        except RateLimitError:
            logger.warning("Rate limit hit fetching match", match_id=match_id)
            raise
        except Exception as e:
            # Rollback in case of error during storage
            await self.db.rollback()
            logger.warning(
                "Failed to fetch/store match", match_id=match_id, error=str(e)
            )
            return False

    def _validate_platform_code(self, platform: str, puuid: str) -> bool:
        """Validate platform code. Returns True if valid, False if invalid."""
        from app.core.riot_api.constants import Platform

        try:
            Platform(platform.lower())
            return True
        except ValueError:
            logger.warning("Invalid platform", puuid=puuid, platform=platform)
            return False

    async def _fetch_new_match_ids_for_player(
        self, riot_api_client: "RiotAPIClient", puuid: str, queue: int
    ) -> list[str]:
        """Fetch and filter to only new match IDs."""
        all_match_ids = await self._fetch_match_ids_from_api(
            riot_api_client, puuid, queue
        )
        if not all_match_ids:
            logger.debug("No matches found for player", puuid=puuid)
            return []

        new_match_ids = await self._get_new_match_ids(all_match_ids)
        already_in_db = len(all_match_ids) - len(new_match_ids)

        logger.debug(
            "Match ID filtering results",
            puuid=puuid,
            total_from_api=len(all_match_ids),
            already_in_database=already_in_db,
            new_matches=len(new_match_ids),
        )

        if not new_match_ids:
            logger.debug("All matches already in database", puuid=puuid)
            return []

        return new_match_ids

    async def fetch_and_store_matches_for_player(
        self,
        riot_api_client: "RiotAPIClient",
        puuid: str,
        count: int = 1,
        queue: int = 420,
        platform: str = "EUN1",
    ) -> int:
        """
        Fetch match history from Riot API and store new matches for a player.

        Used by background jobs only.
        This method checks the database before fetching to avoid duplicate API calls.

        Args:
            riot_api_client: RiotAPIClient instance (from jobs)
            puuid: Player PUUID
            count: Maximum number of NEW matches to fetch (not total matches)
            queue: Queue ID filter (default: 420 = Ranked Solo/Duo)
            platform: Platform ID for the player

        Returns:
            Number of new matches fetched and stored

        Raises:
            RateLimitError: If Riot API rate limit is hit
            AuthenticationError: If API key is invalid
            ForbiddenError: If API key is expired
            ValueError: If invalid platform provided
        """
        try:
            # Validate platform
            if not self._validate_platform_code(platform, puuid):
                return 0

            # Fetch new match IDs
            new_match_ids = await self._fetch_new_match_ids_for_player(
                riot_api_client, puuid, queue
            )
            if not new_match_ids:
                return 0

            # Fetch requested count of new matches
            fetched_count = 0
            for match_id in new_match_ids[:count]:
                if await self._fetch_and_store_single_match(riot_api_client, match_id):
                    fetched_count += 1

            logger.info(
                "Fetched matches for player",
                puuid=puuid,
                count=fetched_count,
                new_matches=len(new_match_ids),
            )
            return fetched_count

        except RiotAPIError:
            # Re-raise RiotAPI errors (rate limits, auth errors, etc.) to caller
            raise
        except Exception as e:
            logger.error("Failed to fetch and store matches", puuid=puuid, error=str(e))
            return 0

    async def _get_matches_from_db(
        self,
        puuid: str,
        start: int,
        count: int,
        queue: Optional[int],
        start_time: Optional[int],
        end_time: Optional[int],
    ) -> List[Match]:
        """Get matches from database."""
        query = (
            select(Match)
            .join(MatchParticipant)
            .where(MatchParticipant.puuid == puuid)
            .order_by(desc(Match.game_start_timestamp))
            .offset(start)
            .limit(count)
        )

        if queue:
            query = query.where(Match.queue_id == queue)
        if start_time:
            query = query.where(Match.game_start_timestamp >= start_time)
        if end_time:
            query = query.where(Match.game_start_timestamp <= end_time)

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def _count_matches_from_db(
        self,
        puuid: str,
        queue: Optional[int],
        start_time: Optional[int],
        end_time: Optional[int],
    ) -> int:
        """Count total matches for a player from database."""
        query = (
            select(func.count(Match.match_id))
            .join(MatchParticipant)
            .where(MatchParticipant.puuid == puuid)
        )

        if queue:
            query = query.where(Match.queue_id == queue)
        if start_time:
            query = query.where(Match.game_start_timestamp >= start_time)
        if end_time:
            query = query.where(Match.game_start_timestamp <= end_time)

        result = await self.db.execute(query)
        return result.scalar_one()

    async def _count_analyzed_matches_from_db(
        self,
        puuid: str,
        queue: Optional[int],
        start_time: Optional[int],
        end_time: Optional[int],
    ) -> int:
        """Count total analyzed matches for a player from database."""
        query = (
            select(func.count(Match.match_id))
            .join(MatchParticipant)
            .where(MatchParticipant.puuid == puuid)
            .where(Match.fully_analyzed == True)
        )

        if queue:
            query = query.where(Match.queue_id == queue)
        if start_time:
            query = query.where(Match.game_start_timestamp >= start_time)
        if end_time:
            query = query.where(Match.game_start_timestamp <= end_time)

        result = await self.db.execute(query)
        return result.scalar_one()

    def _get_player_info_for_puuid(
        self, puuid: str, participants: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Extract player info for a PUUID from participant data."""
        participant = next(
            (p for p in participants if p["puuid"] == puuid),
            None,
        )
        if not participant:
            return {
                "game_name": "Unknown Player",
                "tag_line": None,
                "summoner_level": 1,
                "profile_icon_id": 29,  # Default icon
            }

        return {
            "game_name": participant.get("game_name") or "Unknown Player",
            "tag_line": participant.get("tag_line"),
            "summoner_level": participant.get("summoner_level", 1),
            "profile_icon_id": participant.get("profile_icon_id", 29),
        }

    async def _ensure_players_exist(
        self,
        participants: List[Dict[str, Any]],
        platform_id: str,
    ) -> None:
        """Ensure all participant players exist in database, creating if needed."""
        # Bulk check for existing players
        participant_puuids = {p["puuid"] for p in participants}
        existing_players_result = await self.db.execute(
            select(Player.puuid).where(Player.puuid.in_(participant_puuids))
        )
        existing_puuids = {row[0] for row in existing_players_result.all()}

        # Bulk create missing players
        missing_puuids = participant_puuids - existing_puuids
        if not missing_puuids:
            return

        new_players = []
        for puuid in missing_puuids:
            info = self._get_player_info_for_puuid(puuid, participants)
            new_players.append(
                Player(
                    puuid=puuid,
                    game_name=info["game_name"],
                    tag_line=info["tag_line"],
                    summoner_level=info["summoner_level"],
                    profile_icon_id=info["profile_icon_id"],
                    platform=platform_id.upper(),
                    is_tracked=False,
                )
            )

        self.db.add_all(new_players)
        logger.debug("Created minimal player records", count=len(new_players))

    async def _store_match_detail(self, match_data: Dict[str, Any]) -> Match:
        """Store match detail in database."""
        try:
            # Validate match data
            if not self.transformer.validate_match_data(match_data):
                raise ValueError("Invalid match data")

            transformed = self.transformer.transform_match_data(match_data)
            platform_id = transformed["match"].get("platform", "EUN1")

            # Ensure all participant players exist
            await self._ensure_players_exist(transformed["participants"], platform_id)

            # Store match and participants
            match = Match(**transformed["match"])
            self.db.add(match)

            participants = [
                MatchParticipant(**p_data) for p_data in transformed["participants"]
            ]
            self.db.add_all(participants)

            await self.db.commit()
            await self.db.refresh(match)

            logger.info("Stored match detail", match_id=match.match_id)
            return match
        except Exception as e:
            await self.db.rollback()
            logger.error("Failed to store match detail", error=str(e))
            raise

    def _calculate_kda(self, kills: int, deaths: int, assists: int) -> float:
        """Calculate KDA ratio."""
        # If no deaths, return perfect KDA (kills + assists)
        if deaths == 0:
            return float(kills + assists)
        return (kills + assists) / deaths

    # ============================================
    # Helper Methods for Jobs
    # ============================================

    async def store_match_from_dto(
        self, match_dto: Any, default_platform: str = "EUN1"
    ) -> Match:
        """Store match and participants from Riot API DTO.

        This method handles:
        - Creating Match record
        - Creating MatchParticipant records
        - Ensuring all participant players exist in database

        Args:
            match_dto: Match DTO from Riot API
            default_platform: Default platform if not in DTO

        Returns:
            Stored Match object

        Raises:
            Exception: If storage fails

        Note:
            Caller must commit the transaction.
        """
        from .transformers import MatchDTOTransformer

        try:
            # Extract platform
            platform_id = match_dto.info.platform or default_platform

            # Ensure all participant players exist
            participants_info = []
            for p in match_dto.info.participants:
                # p is ParticipantDTO which has fields aliased from API response
                # game_name -> riotIdGameName, tag_line -> riotIdTagline
                game_name = p.game_name or p.summoner_name or "Unknown"
                tag_line = p.tag_line

                # If using summonerName and no tag, try to split if it contains #
                if not tag_line and "#" in game_name:
                    game_name, tag_line = game_name.split("#", 1)

                participants_info.append(
                    {
                        "puuid": p.puuid,
                        "game_name": game_name,
                        "tag_line": tag_line or "RIOT",
                        "summoner_level": p.summoner_level,
                        "profile_icon_id": getattr(p, "profile_icon", 29),
                    }
                )

            await self._ensure_players_exist(participants_info, platform_id)

            # Calculate flags
            early_surrender = any(
                p.game_ended_in_early_surrender for p in match_dto.info.participants
            )
            surrender = any(
                p.game_ended_in_surrender for p in match_dto.info.participants
            )

            # Create Match record
            match = Match(
                match_id=match_dto.metadata.match_id,
                platform=platform_id.upper(),
                game_start_timestamp=match_dto.info.game_start_timestamp,
                game_end_timestamp=match_dto.info.game_end_timestamp,
                game_duration=match_dto.info.game_duration,
                game_mode=match_dto.info.game_mode,
                game_type=match_dto.info.game_type,
                game_version=match_dto.info.game_version,
                map_id=match_dto.info.map_id,
                queue_id=match_dto.info.queue_id,
                early_surrender=early_surrender,
                surrender=surrender,
                game_result=match_dto.info.game_result,
            )

            self.db.add(match)

            # Create MatchParticipant records
            for participant in match_dto.info.participants:
                participant_data = MatchDTOTransformer.extract_participant_data(
                    participant
                )
                match_participant = MatchParticipant(
                    match_id=match_dto.metadata.match_id,
                    **participant_data,
                )
                self.db.add(match_participant)

            logger.debug(
                "Stored match from DTO",
                match_id=match_dto.metadata.match_id,
                participant_count=len(match_dto.info.participants),
            )

            return match

        except Exception as e:
            logger.error(
                "Failed to store match from DTO",
                match_id=(
                    match_dto.metadata.match_id
                    if hasattr(match_dto, "metadata")
                    else "unknown"
                ),
                error=str(e),
            )
            raise

    async def count_player_matches(self, puuid: str) -> int:
        """Get count of matches for a player in database.

        Args:
            puuid: Player PUUID

        Returns:
            Number of matches in database
        """
        count_stmt = (
            select(func.count(Match.match_id))
            .join(MatchParticipant, Match.match_id == MatchParticipant.match_id)
            .where(MatchParticipant.puuid == puuid)
        )
        count_result = await self.db.execute(count_stmt)
        return count_result.scalar() or 0

    async def get_player_last_match_time(self, puuid: str) -> Optional[int]:
        """Get timestamp of player's most recent match in database.

        Args:
            puuid: Player PUUID

        Returns:
            Timestamp in milliseconds, or None if no matches
        """
        stmt = (
            select(Match.game_start_timestamp)
            .join(MatchParticipant, Match.match_id == MatchParticipant.match_id)
            .where(MatchParticipant.puuid == puuid)
            .order_by(Match.game_start_timestamp.desc())
            .limit(1)
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    async def filter_existing_matches(self, match_ids: List[str]) -> List[str]:
        """Filter out matches that already exist in database.

        Args:
            match_ids: List of match IDs to check

        Returns:
            List of match IDs not in database
        """
        if not match_ids:
            return []

        stmt = select(Match.match_id).where(Match.match_id.in_(match_ids))
        result = await self.db.execute(stmt)
        existing_match_ids = set(result.scalars().all())

        new_match_ids = [mid for mid in match_ids if mid not in existing_match_ids]

        logger.debug(
            "Filtered existing matches",
            total_ids=len(match_ids),
            existing=len(existing_match_ids),
            new=len(new_match_ids),
        )

        return new_match_ids

    async def analyze_match_history(
        self,
        riot_api_client: Any,
        puuid: str,
        progress_callback: Optional[Any] = None,
        should_cancel: Optional[Any] = None,
    ) -> int:
        """
        Analyze matches for a player by re-fetching details from Riot API and updating DB.
        Fetches up to 100 recent matches from Riot API (not just DB) to ensure new matches are caught.

        Args:
            riot_api_client: Initialized client
            puuid: Player PUUID
            progress_callback: Optional async callback(current, total)
            should_cancel: Optional callable returning bool. If True, stops processing.
        """
        try:
            # Check cancel before starting
            if should_cancel and should_cancel():
                logger.info("Analysis cancelled before fetching list", puuid=puuid)
                return 0

            # 1. Get recent match IDs from Riot API (Limit 100 to catch new + update recent old)
            match_list = await riot_api_client.get_match_list_by_puuid(
                puuid=puuid, count=100, queue=420
            )

            match_ids = []
            if match_list:
                if hasattr(match_list, "match_ids"):
                    match_ids = list(match_list.match_ids)
                elif isinstance(match_list, list):
                    match_ids = match_list

            import sys

            print(
                f"DEBUG: Riot API returned {len(match_ids)} matches for PUUID {puuid}",
                file=sys.stderr,
            )

            if not match_ids:
                logger.info("No matches found in Riot API", puuid=puuid)
                return 0

            logger.info(
                "Starting match history analysis (fetch & update)",
                puuid=puuid,
                count=len(match_ids),
            )

            processed = 0
            total = len(match_ids)

            import asyncio

            for i, match_id in enumerate(match_ids):
                # Check for cancellation
                if should_cancel and should_cancel():
                    logger.info(
                        "Analysis cancelled by user request",
                        puuid=puuid,
                        processed=processed,
                    )
                    break

                # Report progress
                if progress_callback:
                    await progress_callback(processed, total)

                # STRICT THROTTLING: 1.2s delay to respect 100 req/2min Dev Key limit
                # We do this proactively to avoid hitting 429s and crashing the batch
                await asyncio.sleep(1.2)

                try:
                    # 2. Fetch fresh DTO
                    match_dto = await riot_api_client.get_match(match_id)
                    if not match_dto:
                        continue

                    # 3. Reprocess (Upsert)
                    await self._reprocess_match(match_dto)
                    processed += 1
                except Exception as e:
                    logger.error(
                        "Failed to reprocess match", match_id=match_id, error=str(e)
                    )
                    # Continue

            # Final
            if progress_callback:
                await progress_callback(processed, total)

            return processed
        except Exception as e:
            logger.error("Match history analysis failed", puuid=puuid, error=str(e))
            raise

    async def _reprocess_match(self, match_dto: Any) -> None:
        """Update existing match or insert new match using merge (upsert)."""
        from .transformers import MatchDTOTransformer

        # Extract platform
        platform_id = match_dto.info.platform or "EUN1"
        match_id = match_dto.metadata.match_id

        # Calculate flags
        early_surrender = any(
            p.game_ended_in_early_surrender for p in match_dto.info.participants
        )
        surrender = any(p.game_ended_in_surrender for p in match_dto.info.participants)

        try:
            # 1. Update Match record
            match = Match(
                match_id=match_id,
                platform=platform_id.upper(),
                game_start_timestamp=match_dto.info.game_start_timestamp,
                game_end_timestamp=match_dto.info.game_end_timestamp,
                game_duration=match_dto.info.game_duration,
                game_mode=match_dto.info.game_mode,
                game_type=match_dto.info.game_type,
                game_version=match_dto.info.game_version,
                map_id=match_dto.info.map_id,
                queue_id=match_dto.info.queue_id,
                early_surrender=early_surrender,
                surrender=surrender,
                game_result=match_dto.info.game_result,
                fully_analyzed=True,  # Match fetched is considered analyzed for history
            )
            # Use merge to upsert
            await self.db.merge(match)

            # 2. Update Participants
            for participant in match_dto.info.participants:
                # Ensure Player Exists (Foreign Key Requirement)
                # Riot API matches include all participants, but not all are in our DB.
                # We upsert a skeletal Player record if missing to satisfy the FK.

                # Basic sanitation
                p_game_name = (
                    participant.game_name or participant.summoner_name or "Unknown"
                )
                p_tag_line = participant.tag_line or (
                    platform_id.replace("1", "") if platform_id else "RIOT"
                )

                # Safety check for empty strings that might come from API
                if not p_game_name or p_game_name == "":
                    p_game_name = "Unknown"
                if not p_tag_line or p_tag_line == "":
                    p_tag_line = "RIOT"

                # Construct minimal player for upsert
                # Note: We use merge, so existing fields (ranks etc) are preserved if we don't set them here
                player_record = Player(
                    puuid=participant.puuid,
                    game_name=p_game_name,
                    tag_line=p_tag_line,
                    platform=platform_id.lower(),
                    profile_icon_id=participant.profile_icon
                    or 29,  # Default icon if missing
                    summoner_level=participant.summoner_level
                    or 0,  # Default level if missing
                    is_tracked=False,
                )
                await self.db.merge(player_record)

                # Now process the match participant
                participant_data = MatchDTOTransformer.extract_participant_data(
                    participant
                )
                match_participant = MatchParticipant(
                    match_id=match_id,
                    **participant_data,
                )
                await self.db.merge(match_participant)

            await self.db.commit()

        except Exception as e:
            await self.db.rollback()
            raise
