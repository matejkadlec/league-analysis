"""Match service for handling match data operations."""

from collections.abc import Callable, Sequence
from typing import Any, NamedTuple

import structlog
from sqlalchemy import ColumnElement, Select, desc, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.riot_api.client import RiotAPIClient
from app.core.riot_api.constants import (
    PRODUCT_SUPPORTED_QUEUE_IDS,
    Region,
    get_region_by_platform,
)
from app.core.riot_api.models import MatchDTO, MatchTimelineDTO
from app.features.jobs.maintenance import ensure_riot_writer_maintenance_is_inactive
from app.features.players.models import Player

from .match_history import (
    build_match_responses,
    load_match_player_data_context,
)
from .match_persistence import upsert_match
from .match_stats import (
    accumulate_champion_stats,
    accumulate_lane_stats,
    build_champion_stat_items,
    build_lane_stat_items,
    calculate_kda,
    page_of,
)
from .match_sync import (
    RIOT_FATAL_ERRORS,
    must_abort_writer_sync,
    sync_single_queue_for_player,
)
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

logger = structlog.get_logger(__name__)


def restrict_participants_to_queues(
    query: Select[tuple[MatchParticipant]],
    queue_ids: Sequence[int] | None,
) -> Select[tuple[MatchParticipant]]:
    """Filter a participant query by queue, joining the match row only if asked.

    The champion and lane aggregates read participants, so the queue lives one
    join away. Without a filter the join is pure cost, which is why this is a
    wrapper rather than a condition in `build_match_history_conditions`.
    """
    if not queue_ids:
        return query
    return query.join(Match, MatchParticipant.match_id == Match.match_id).where(
        Match.queue_id.in_(queue_ids)
    )


def build_match_history_conditions(
    puuid: str,
    queue_ids: Sequence[int] | None = None,
    search: str | None = None,
) -> list[ColumnElement[bool]]:
    """Build shared filters so search and queue unions precede pagination."""
    match_table = Match.__table__
    player_participant = MatchParticipant.__table__.alias("player_participant")
    conditions: list[ColumnElement[bool]] = [
        exists(
            select(1).where(
                player_participant.c.match_id == match_table.c.match_id,
                player_participant.c.puuid == puuid,
            )
        )
    ]

    if queue_ids:
        conditions.append(match_table.c.queue_id.in_(queue_ids))

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


class ParticipantTotals(NamedTuple):
    """The per-participant sums one stats response averages over."""

    kills: int
    deaths: int
    assists: int
    cs: int
    vision: int
    wins: int


class MatchService:
    """Service for handling match data operations."""

    SUPPORTED_SYNC_QUEUE_IDS: tuple[int, ...] = PRODUCT_SUPPORTED_QUEUE_IDS

    def __init__(self, db: AsyncSession):
        """Initialize match service with database session only."""
        self.db = db

    async def get_player_matches(
        self,
        puuid: str,
        start: int = 0,
        count: int = 20,
        queue_ids: Sequence[int] | None = None,
    ) -> MatchListResponse:
        """
        Get match history for a player from database only.

        Never calls Riot API - returns whatever matches are available in database.
        Supports pagination for infinite scroll.

        Args:
            puuid: Player PUUID
            start: Start index for pagination
            count: Number of matches to return
            queue_ids: Restrict to this queue union (e.g., 420 for ranked solo)

        Returns:
            MatchListResponse with matches from database
        """
        db_matches, total_count, total_analyzed = await self._fetch_match_page(
            puuid=puuid,
            start=start,
            count=count,
            queue_ids=queue_ids,
        )

        match_responses = [MatchResponse.model_validate(match) for match in db_matches]

        page = page_of(start, count)
        size = count

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
        )

    async def get_player_matches_with_data(
        self,
        puuid: str,
        start: int = 0,
        count: int = 20,
        queue_ids: Sequence[int] | None = None,
        search: str | None = None,
    ) -> MatchListWithPlayerDataResponse:
        """
        Get match history for a player with participant data.

        Returns matches with the player's champion, stats, lane opponent,
        and LP changes.

        Args:
            puuid: Player PUUID
            start: Start index for pagination
            count: Number of matches to return
            queue_ids: Restrict to this queue union (e.g., 420 for ranked solo)
            search: Case-insensitive champion or participant Riot ID filter

        Returns:
            MatchListWithPlayerDataResponse with detailed match data
        """
        db_matches, total_count, total_analyzed = await self._fetch_match_page(
            puuid=puuid,
            start=start,
            count=count,
            queue_ids=queue_ids,
            search=search,
        )

        if not db_matches:
            page = page_of(start, count)
            return MatchListWithPlayerDataResponse(
                matches=[],
                total=total_count,
                total_analyzed=total_analyzed,
                page=page,
                size=count,
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
        page = page_of(start, count)

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
        )

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
    ) -> ParticipantTotals:
        """Aggregate the player's combat and vision sums plus wins."""
        kills = deaths = assists = cs = vision = wins = 0

        for match in matches:
            participant = participants_by_match.get(match.match_id)
            if participant:
                kills += participant.kills
                deaths += participant.deaths
                assists += participant.assists
                cs += participant.cs
                vision += participant.vision_score
                if participant.win:
                    wins += 1

        return ParticipantTotals(kills, deaths, assists, cs, vision, wins)

    async def get_player_stats(
        self,
        puuid: str,
        queue_ids: Sequence[int] | None = None,
        limit: int | None = None,
    ) -> MatchStatsResponse:
        """
        Calculate player statistics from recent matches.

        A `limit` of None analyzes every stored match, not a page of them.
        """
        # If limit is None, get all matches (use a high count)
        fetch_limit = limit if limit is not None else 10000
        matches = await self.get_player_matches(
            puuid,
            count=fetch_limit,
            queue_ids=queue_ids,
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

        totals = self._aggregate_participant_stats(
            matches.matches, participants_by_match
        )

        total_matches = len(matches.matches)
        avg_kda = calculate_kda(totals.kills, totals.deaths, totals.assists)

        # total_matches is guaranteed > 0 (checked for empty matches above)
        return MatchStatsResponse(
            puuid=puuid,
            total_matches=total_matches,
            wins=totals.wins,
            losses=total_matches - totals.wins,
            win_rate=totals.wins / total_matches,
            avg_kills=totals.kills / total_matches,
            avg_deaths=totals.deaths / total_matches,
            avg_assists=totals.assists / total_matches,
            avg_kda=avg_kda,
            avg_cs=totals.cs / total_matches,
            avg_vision_score=totals.vision / total_matches,
        )

    async def get_player_champion_stats(
        self,
        puuid: str,
        queue_ids: Sequence[int] | None = None,
    ) -> ChampionStatsResponse:
        """
        Get player statistics grouped by champion.

        `queue_ids` restricts to a queue union (e.g., 420 for ranked solo).
        """
        query = restrict_participants_to_queues(
            select(MatchParticipant).where(MatchParticipant.puuid == puuid),
            queue_ids,
        )

        result = await self.db.execute(query)
        participants = result.scalars().all()

        if not participants:
            return ChampionStatsResponse(puuid=puuid, total_champions=0, champions=[])

        champion_data = accumulate_champion_stats(participants)
        champions = build_champion_stat_items(champion_data)
        return ChampionStatsResponse(
            puuid=puuid,
            total_champions=len(champion_data),
            champions=champions,
        )

    async def get_player_lane_stats(
        self,
        puuid: str,
        queue_ids: Sequence[int] | None = None,
    ) -> LaneStatsResponse:
        """
        Get player statistics grouped by lane/position.

        `queue_ids` restricts to a queue union (e.g., 420 for ranked solo).
        """
        query = restrict_participants_to_queues(
            select(MatchParticipant).where(
                MatchParticipant.puuid == puuid,
                MatchParticipant.team_position.isnot(None),
                MatchParticipant.team_position != "",
                MatchParticipant.team_position != "UNKNOWN",
            ),
            queue_ids,
        )

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

    async def _fetch_match_page(
        self,
        puuid: str,
        start: int,
        count: int,
        queue_ids: Sequence[int] | None = None,
        search: str | None = None,
    ) -> tuple[list[Match], int, int]:
        """Return one page of matches with its total and analyzed total.

        Both totals come from a single pass: `count(*) FILTER (WHERE ...)`
        answers "how many are analyzed" from the same scan the plain count
        already needed, so a page costs two round trips rather than three.
        """
        conditions = build_match_history_conditions(
            puuid=puuid,
            queue_ids=queue_ids,
            search=search,
        )

        page = await self.db.execute(
            select(Match)
            .where(*conditions)
            .order_by(desc(Match.game_start_timestamp), desc(Match.match_id))
            .offset(start)
            .limit(count)
        )
        totals = await self.db.execute(
            select(
                func.count(Match.match_id),
                func.count(Match.match_id).filter(Match.fully_analyzed.is_(True)),
            ).where(*conditions)
        )

        total, total_analyzed = totals.one()
        return list(page.scalars().all()), total, total_analyzed

    # ============================================
    # Helper Methods for Jobs
    # ============================================

    async def _reprocess_match(
        self,
        match_dto: MatchDTO,
        timeline_payload: MatchTimelineDTO | None = None,
    ) -> None:
        """Update existing match or insert new match using merge (upsert).

        Delegates to `upsert_match` so there is exactly one copy of the
        match-persistence sequence; this wrapper adds the cleanup interlock.
        """
        await ensure_riot_writer_maintenance_is_inactive(self.db)
        await upsert_match(self.db, match_dto, timeline_payload)

    async def sync_matches_for_player(
        self,
        riot_client: RiotAPIClient,
        player: Player,
        on_failure: Callable[[str, Exception, dict[str, Any]], None] | None = None,
        on_match_stored: Callable[[int, str], None] | None = None,
    ) -> int:
        """
        Sync matches for a player from Riot API (Current Season).
        Fetches match IDs in batches and stores missing matches.
        """
        puuid = player.puuid
        platform = player.platform

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
                    on_failure=on_failure,
                    on_match_stored=on_match_stored,
                )
                total_stored += queue_stored
            except RIOT_FATAL_ERRORS:
                raise
            except Exception as e:
                if must_abort_writer_sync(e):
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
            on_failure=on_failure,
            reprocess_match=self._reprocess_match,
            on_match_stored=on_match_stored,
        )
