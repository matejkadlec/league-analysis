"""Match service for handling match data operations."""

from collections.abc import Callable, Sequence
from typing import Any, Protocol

import structlog
from sqlalchemy import desc, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.riot_api.client import RiotAPIClient
from app.core.riot_api.constants import (
    PRODUCT_SUPPORTED_QUEUE_IDS,
    Region,
    get_region_by_platform,
    normalize_platform,
)
from app.core.riot_api.db_rate_limiter import DBRateLimiter
from app.core.riot_api.errors import (
    AuthenticationError,
    ForbiddenError,
    NotFoundError,
    RateLimitError,
    RiotAPIError,
)
from app.core.riot_api.models import MatchDTO, MatchTimelineDTO
from app.features.players.models import Player

from .match_history import (
    build_match_responses,
    load_match_player_data_context,
)
from .match_lp import RANKED_SOLO_QUEUE_ID
from .match_persistence import (
    add_participants_from_dto,
    build_match_record,
    extract_store_participant_identity,
    match_dto_id,
    match_end_flags,
    upsert_match,
)
from .match_stats import (
    accumulate_champion_stats,
    accumulate_lane_stats,
    build_champion_stat_items,
    build_lane_stat_items,
    calculate_kda,
    page_window,
)
from .match_sync import must_abort_writer_sync, sync_single_queue_for_player
from .models import Match
from .participants import MatchParticipant
from .schemas import (
    ChampionStatsResponse,
    LaneStatsResponse,
    MatchListResponse,
    MatchListWithPlayerDataResponse,
    MatchResponse,
    MatchStatsResponse,
)
from .timeline import replace_match_timeline_rows

logger = structlog.get_logger(__name__)


class SyncablePlayer(Protocol):
    """The identity slice of a player that queue sync actually reads.

    Callers hand this method several unrelated shapes -- a `PlayerResponse`
    schema from the job layer, a throwaway holder from the background-sync
    route -- and only `puuid` and `platform` are ever touched, so naming the
    two fields is more honest than either concrete type would be.
    """

    @property
    def puuid(self) -> str: ...

    @property
    def platform(self) -> str: ...


def normalize_match_queue_ids(
    queue: int | None, queue_ids: Sequence[int] | None
) -> tuple[int, ...] | None:
    """Return one stable queue union while preserving the legacy scalar filter."""
    if queue_ids is not None:
        return tuple(dict.fromkeys(queue_ids)) or None
    if queue is not None:
        return (queue,)
    return None


def build_match_history_conditions(
    puuid: str,
    queue_ids: Sequence[int] | None = None,
    search: str | None = None,
    start_time: int | None = None,
    end_time: int | None = None,
    exclude_aram: bool = False,
) -> list[Any]:
    """Build shared filters so search and queue unions precede pagination."""
    match_table = Match.__table__
    player_participant = MatchParticipant.__table__.alias("player_participant")
    conditions: list[Any] = [
        exists(
            select(1).where(
                player_participant.c.match_id == match_table.c.match_id,
                player_participant.c.puuid == puuid,
            )
        )
    ]

    if queue_ids:
        conditions.append(match_table.c.queue_id.in_(queue_ids))
    if exclude_aram:
        conditions.append(match_table.c.queue_id != 450)
    if start_time is not None:
        conditions.append(match_table.c.game_start_timestamp >= start_time)
    if end_time is not None:
        conditions.append(match_table.c.game_start_timestamp <= end_time)

    normalized_search = search.strip() if search else ""
    if normalized_search:
        searchable_participant = MatchParticipant.__table__.alias(
            "searchable_participant"
        )
        full_riot_id = func.concat(
            searchable_participant.c.game_name,
            "#",
            searchable_participant.c.tag_line,
        )
        conditions.append(
            exists(
                select(1).where(
                    searchable_participant.c.match_id == match_table.c.match_id,
                    or_(
                        searchable_participant.c.champion_name.icontains(
                            normalized_search, autoescape=True
                        ),
                        searchable_participant.c.game_name.icontains(
                            normalized_search, autoescape=True
                        ),
                        searchable_participant.c.tag_line.icontains(
                            normalized_search, autoescape=True
                        ),
                        full_riot_id.icontains(normalized_search, autoescape=True),
                    ),
                )
            )
        )

    return conditions


def _must_abort_writer_sync(error: Exception) -> bool:
    """Return whether a lower-level sync error must reach the owning job."""
    return must_abort_writer_sync(error)


async def _ensure_riot_writer_maintenance_is_inactive(session: AsyncSession) -> None:
    """Avoid importing the jobs package until a direct Riot-data write runs."""
    from app.features.jobs.maintenance import ensure_riot_writer_maintenance_is_inactive

    await ensure_riot_writer_maintenance_is_inactive(session)


class MatchService:
    """Service for handling match data operations."""

    SUPPORTED_SYNC_QUEUE_IDS: tuple[int, ...] = PRODUCT_SUPPORTED_QUEUE_IDS
    CURRENT_GAME_VERSION_PREFIX = "16."

    def __init__(self, db: AsyncSession):
        """Initialize match service with database session only."""
        self.db = db

    @classmethod
    def is_current_game_version(cls, game_version: str) -> bool:
        """Whether a Riot match belongs to the supported current release year."""
        return game_version.startswith(cls.CURRENT_GAME_VERSION_PREFIX)

    async def get_player_matches(
        self,
        puuid: str,
        start: int = 0,
        count: int = 20,
        queue: int | None = None,
        queue_ids: Sequence[int] | None = None,
        start_time: int | None = None,
        end_time: int | None = None,
        exclude_aram: bool = False,
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
            exclude_aram: Whether to exclude queue 450 (ARAM)

        Returns:
            MatchListResponse with matches from database
        """
        try:
            effective_queue_ids = normalize_match_queue_ids(queue, queue_ids)

            # Get matches from database only
            db_matches = await self._get_matches_from_db(
                puuid=puuid,
                start=start,
                count=count,
                queue_ids=effective_queue_ids,
                start_time=start_time,
                end_time=end_time,
                exclude_aram=exclude_aram,
            )

            # Get total count of matches for pagination
            total_count = await self._count_matches_from_db(
                puuid=puuid,
                queue_ids=effective_queue_ids,
                start_time=start_time,
                end_time=end_time,
                exclude_aram=exclude_aram,
            )

            # Get total analyzed matches count
            total_analyzed = await self._count_analyzed_matches_from_db(
                puuid=puuid,
                queue_ids=effective_queue_ids,
                start_time=start_time,
                end_time=end_time,
                exclude_aram=exclude_aram,
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

    async def get_player_matches_with_data(
        self,
        puuid: str,
        start: int = 0,
        count: int = 20,
        queue: int | None = None,
        queue_ids: Sequence[int] | None = None,
        search: str | None = None,
        exclude_aram: bool = False,
    ) -> MatchListWithPlayerDataResponse:
        """
        Get match history for a player with participant data.

        Returns matches with the player's champion, stats, lane opponent,
        and LP changes.

        Args:
            puuid: Player PUUID
            start: Start index for pagination
            count: Number of matches to return
            queue: Filter by queue ID
            exclude_aram: Whether to exclude queue 450 (ARAM)

        Returns:
            MatchListWithPlayerDataResponse with detailed match data
        """
        try:
            effective_queue_ids = normalize_match_queue_ids(queue, queue_ids)
            db_matches = await self._get_matches_from_db(
                puuid=puuid,
                start=start,
                count=count,
                queue_ids=effective_queue_ids,
                search=search,
                exclude_aram=exclude_aram,
            )

            total_count = await self._count_matches_from_db(
                puuid=puuid,
                queue_ids=effective_queue_ids,
                search=search,
                exclude_aram=exclude_aram,
            )
            total_analyzed = await self._count_analyzed_matches_from_db(
                puuid=puuid,
                queue_ids=effective_queue_ids,
                search=search,
                exclude_aram=exclude_aram,
            )

            if not db_matches:
                page, pages = page_window(start, count, total_count)
                return MatchListWithPlayerDataResponse(
                    matches=[],
                    total=total_count,
                    total_analyzed=total_analyzed,
                    page=page,
                    size=count,
                    pages=pages,
                )
            (
                player_participants_by_match,
                participants_by_match,
                timelines_by_match_team,
            ) = await load_match_player_data_context(
                self.db,
                puuid,
                [match.match_id for match in db_matches],
            )
            match_responses = build_match_responses(
                db_matches,
                player_participants_by_match,
                participants_by_match,
                timelines_by_match_team,
                puuid,
            )
            page, pages = page_window(start, count, total_count)

            logger.debug(
                "Retrieved matches with player data",
                puuid=puuid,
                matches_count=len(match_responses),
                total_count=total_count,
            )

            return MatchListWithPlayerDataResponse(
                matches=match_responses,
                total=total_count,
                total_analyzed=total_analyzed,
                page=page,
                size=count,
                pages=pages,
            )
        except Exception as e:
            logger.error(
                "Failed to get player matches with data",
                puuid=puuid,
                error=str(e),
                exc_info=True,
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
        matches: list[MatchResponse],
        participants_by_match: dict[str, MatchParticipant],
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
        self,
        puuid: str,
        queue: int | None = None,
        queue_ids: Sequence[int] | None = None,
        limit: int | None = None,
        exclude_aram: bool = False,
    ) -> MatchStatsResponse:
        """
        Calculate player statistics from recent matches.

        Args:
            puuid: Player PUUID
            queue: Filter by queue ID
            limit: Number of matches to analyze. If None, analyze all matches.
            exclude_aram: Whether to exclude queue 450 (ARAM)

        Returns:
            MatchStatsResponse with player statistics
        """
        try:
            # If limit is None, get all matches (use a high count)
            fetch_limit = limit if limit is not None else 10000
            # Get recent matches for the player
            matches = await self.get_player_matches(
                puuid,
                count=fetch_limit,
                queue=queue,
                queue_ids=queue_ids,
                exclude_aram=exclude_aram,
            )

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

    async def get_player_champion_stats(
        self,
        puuid: str,
        queue: int | None = None,
    ) -> ChampionStatsResponse:
        """
        Get player statistics grouped by champion.

        Args:
            puuid: Player PUUID
            queue: Filter by queue ID (e.g., 420 for ranked solo/duo)

        Returns:
            ChampionStatsResponse with every qualifying champion statistic
        """
        try:
            query = select(MatchParticipant).where(MatchParticipant.puuid == puuid)
            if queue is not None:
                query = query.join(
                    Match, MatchParticipant.match_id == Match.match_id
                ).where(Match.queue_id == queue)

            result = await self.db.execute(query)
            participants = result.scalars().all()

            if not participants:
                return ChampionStatsResponse(
                    puuid=puuid, total_champions=0, champions=[]
                )

            champion_data = accumulate_champion_stats(participants)
            champions = build_champion_stat_items(champion_data)
            return ChampionStatsResponse(
                puuid=puuid,
                total_champions=len(champion_data),
                champions=champions,
            )
        except Exception as e:
            logger.error(
                "Failed to get player champion stats", puuid=puuid, error=str(e)
            )
            raise

    async def get_player_lane_stats(
        self,
        puuid: str,
        queue: int | None = None,
    ) -> LaneStatsResponse:
        """
        Get player statistics grouped by lane/position.

        Args:
            puuid: Player PUUID
            queue: Filter by queue ID (e.g., 420 for ranked solo/duo)

        Returns:
            LaneStatsResponse with per-lane statistics
        """
        try:
            query = select(MatchParticipant).where(
                MatchParticipant.puuid == puuid,
                MatchParticipant.team_position.isnot(None),
                MatchParticipant.team_position != "",
                MatchParticipant.team_position != "UNKNOWN",
            )
            if queue is not None:
                query = query.join(
                    Match, MatchParticipant.match_id == Match.match_id
                ).where(Match.queue_id == queue)

            result = await self.db.execute(query)
            participants = result.scalars().all()

            if not participants:
                return LaneStatsResponse(puuid=puuid, total_lanes=0, lanes=[])

            lane_data = accumulate_lane_stats(participants)
            return LaneStatsResponse(
                puuid=puuid,
                total_lanes=len(lane_data),
                lanes=build_lane_stat_items(lane_data),
            )
        except Exception as e:
            logger.error("Failed to get player lane stats", puuid=puuid, error=str(e))
            raise

    async def fetch_player_matches(
        self,
        riot_api_client: RiotAPIClient,
        puuid: str,
        count: int = 20,
        queue: int | None = None,
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
            # Fetch match IDs (the helper requests the stable API batch size).
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
        self, riot_api_client: RiotAPIClient, puuid: str, queue: int | None
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
        self, riot_api_client: RiotAPIClient, match_id: str
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
                timeline_payload: MatchTimelineDTO | None = None
                try:
                    timeline_payload = await riot_api_client.get_match_timeline(
                        match_id
                    )
                except Exception as timeline_error:
                    logger.warning(
                        "Failed to fetch match timeline, storing match without timeline",
                        match_id=match_id,
                        error=str(timeline_error),
                    )
                # Use new storage method via DTO directly
                await self.store_match_from_dto(
                    match_dto,
                    timeline_payload=timeline_payload,
                )
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
        self, riot_api_client: RiotAPIClient, puuid: str, queue: int
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
        riot_api_client: RiotAPIClient,
        puuid: str,
        count: int = 1,
        queue: int = RANKED_SOLO_QUEUE_ID,
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
        queue: int | None = None,
        queue_ids: Sequence[int] | None = None,
        search: str | None = None,
        start_time: int | None = None,
        end_time: int | None = None,
        exclude_aram: bool = False,
    ) -> list[Match]:
        """Get matches from database."""
        effective_queue_ids = normalize_match_queue_ids(queue, queue_ids)
        query = (
            select(Match)
            .where(
                *build_match_history_conditions(
                    puuid=puuid,
                    queue_ids=effective_queue_ids,
                    search=search,
                    start_time=start_time,
                    end_time=end_time,
                    exclude_aram=exclude_aram,
                )
            )
            .order_by(desc(Match.game_start_timestamp), desc(Match.match_id))
            .offset(start)
            .limit(count)
        )

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def _count_matches_from_db(
        self,
        puuid: str,
        queue: int | None = None,
        queue_ids: Sequence[int] | None = None,
        search: str | None = None,
        start_time: int | None = None,
        end_time: int | None = None,
        exclude_aram: bool = False,
    ) -> int:
        """Count total matches for a player from database."""
        effective_queue_ids = normalize_match_queue_ids(queue, queue_ids)
        query = select(func.count(Match.match_id)).where(
            *build_match_history_conditions(
                puuid=puuid,
                queue_ids=effective_queue_ids,
                search=search,
                start_time=start_time,
                end_time=end_time,
                exclude_aram=exclude_aram,
            )
        )

        result = await self.db.execute(query)
        return result.scalar_one()

    async def _count_analyzed_matches_from_db(
        self,
        puuid: str,
        queue: int | None = None,
        queue_ids: Sequence[int] | None = None,
        search: str | None = None,
        start_time: int | None = None,
        end_time: int | None = None,
        exclude_aram: bool = False,
    ) -> int:
        """Count total analyzed matches for a player from database."""
        effective_queue_ids = normalize_match_queue_ids(queue, queue_ids)
        query = select(func.count(Match.match_id)).where(
            *build_match_history_conditions(
                puuid=puuid,
                queue_ids=effective_queue_ids,
                search=search,
                start_time=start_time,
                end_time=end_time,
                exclude_aram=exclude_aram,
            ),
            Match.fully_analyzed.is_(True),
        )

        result = await self.db.execute(query)
        return result.scalar_one()

    def _get_player_info_for_puuid(
        self, puuid: str, participants: list[dict[str, Any]]
    ) -> dict[str, Any]:
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
        participants: list[dict[str, Any]],
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

        new_players: list[Player] = []
        for puuid in missing_puuids:
            info = self._get_player_info_for_puuid(puuid, participants)
            new_players.append(
                Player(
                    puuid=puuid,
                    game_name=info["game_name"],
                    tag_line=info["tag_line"],
                    summoner_level=info["summoner_level"],
                    profile_icon_id=info["profile_icon_id"],
                    platform=normalize_platform(platform_id),
                    is_tracked=False,
                )
            )

        self.db.add_all(new_players)
        logger.debug("Created minimal player records", count=len(new_players))

    def _calculate_kda(self, kills: int, deaths: int, assists: int) -> float:
        """Calculate KDA ratio."""
        return calculate_kda(kills, deaths, assists)

    # ============================================
    # Helper Methods for Jobs
    # ============================================

    async def store_match_from_dto(
        self,
        match_dto: MatchDTO,
        default_platform: str = "EUN1",
        timeline_payload: MatchTimelineDTO | None = None,
    ) -> Match:
        """Store match and participants from Riot API DTO.

        This method handles:
        - Creating Match record
        - Creating MatchParticipant records
        - Ensuring all participant players exist in database

        Args:
            match_dto: Match DTO from Riot API
            default_platform: Default platform if not in DTO
            timeline_payload: Optional timeline payload from /timeline endpoint

        Returns:
            Stored Match object

        Raises:
            Exception: If storage fails

        Note:
            Caller must commit the transaction.
        """
        try:
            await _ensure_riot_writer_maintenance_is_inactive(self.db)
            platform_id = match_dto.info.platform or default_platform
            participants_info = [
                extract_store_participant_identity(participant)
                for participant in match_dto.info.participants
            ]
            await self._ensure_players_exist(participants_info, platform_id)
            early_surrender, surrender = match_end_flags(match_dto.info.participants)
            match = build_match_record(
                match_dto,
                platform_id,
                early_surrender,
                surrender,
            )
            self.db.add(match)
            add_participants_from_dto(self.db, match_dto)
            timeline_rows = await replace_match_timeline_rows(
                self.db,
                match_dto,
                timeline_payload,
            )

            logger.debug(
                "Stored match from DTO",
                match_id=match_dto.metadata.match_id,
                participant_count=len(match_dto.info.participants),
                timeline_rows=timeline_rows,
            )

            return match

        except Exception as e:
            logger.error(
                "Failed to store match from DTO",
                match_id=match_dto_id(match_dto),
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

    async def get_player_last_match_time(self, puuid: str) -> int | None:
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

    async def filter_existing_matches(self, match_ids: list[str]) -> list[str]:
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

    async def _reprocess_match(
        self,
        match_dto: MatchDTO,
        timeline_payload: MatchTimelineDTO | None = None,
    ) -> None:
        """Update existing match or insert new match using merge (upsert).

        Delegates to `upsert_match` so there is exactly one copy of the
        match-persistence sequence; this wrapper adds the cleanup interlock.
        """
        await _ensure_riot_writer_maintenance_is_inactive(self.db)
        await upsert_match(self.db, match_dto, timeline_payload)

    async def sync_matches_for_player(
        self,
        riot_client: RiotAPIClient,
        player: SyncablePlayer,
        rate_limiter: DBRateLimiter | None = None,
        on_failure: Callable[[str, Exception, dict[str, Any]], None] | None = None,
        on_match_stored: Callable[[int, str], None] | None = None,
    ) -> int:
        """
        Sync matches for a player from Riot API (Current Season).
        Fetches match IDs in batches and stores missing matches.

        Args:
            riot_client: The Riot API client
            player: Player object with puuid and platform
            rate_limiter: Optional DB rate limiter for coordinated rate limiting
        """
        puuid = getattr(player, "puuid", None)
        platform = getattr(player, "platform", None)

        if not puuid or not platform:
            logger.error("Invalid player object passed to sync_matches", player=player)
            return 0

        region = get_region_by_platform(platform)
        queue_ids = list(self.SUPPORTED_SYNC_QUEUE_IDS)

        logger.info(
            "Starting supported-queue match sync",
            puuid=puuid,
            platform=platform,
            supported_queue_ids=queue_ids,
        )

        total_stored = 0
        for queue_id in queue_ids:
            try:
                queue_stored = await self._sync_single_queue_for_player(
                    riot_client=riot_client,
                    puuid=puuid,
                    region=region,
                    queue_id=queue_id,
                    rate_limiter=rate_limiter,
                    on_failure=on_failure,
                    on_match_stored=on_match_stored,
                )
                total_stored += queue_stored
            except AuthenticationError, ForbiddenError, RateLimitError:
                raise
            except Exception as e:
                if _must_abort_writer_sync(e):
                    raise
                logger.warning(
                    "Queue sync failed, continuing with next queue",
                    puuid=puuid,
                    queue_id=queue_id,
                    error=str(e),
                )
                if on_failure:
                    on_failure(
                        "queue synchronization",
                        e,
                        {"queue_id": queue_id},
                    )
                continue

        return total_stored

    async def _sync_single_queue_for_player(
        self,
        riot_client: RiotAPIClient,
        puuid: str,
        region: Region,
        queue_id: int,
        rate_limiter: DBRateLimiter | None,
        on_failure: Callable[[str, Exception, dict[str, Any]], None] | None,
        on_match_stored: Callable[[int, str], None] | None = None,
    ) -> int:
        """Sync one queue for a single player."""
        return await sync_single_queue_for_player(
            session=self.db,
            riot_client=riot_client,
            puuid=puuid,
            region=region,
            queue_id=queue_id,
            rate_limiter=rate_limiter,
            on_failure=on_failure,
            ensure_maintenance=_ensure_riot_writer_maintenance_is_inactive,
            is_current_game_version=self.is_current_game_version,
            reprocess_match=self._reprocess_match,
            on_match_stored=on_match_stored,
        )
