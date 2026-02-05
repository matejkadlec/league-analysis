"""Match service for handling match data operations."""

from typing import Optional, List, Dict, Any, TYPE_CHECKING
import structlog
import asyncio

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc

from .models import Match
from .participants import MatchParticipant
from app.features.players.models import Player
from app.features.players.leagues import PlayerLeague
from .schemas import (
    MatchResponse,
    MatchListResponse,
    MatchStatsResponse,
    MatchWithPlayerData,
    MatchListWithPlayerDataResponse,
    PlayerMatchParticipant,
    EnemyLaneOpponent,
    TeamChampion,
    TeamComposition,
    TeamStats,
    TeamStatsComposition,
)
from app.core.riot_api.transformers import MatchTransformer
from app.core.riot_api.errors import (
    RiotAPIError,
    RateLimitError,
    AuthenticationError,
    ForbiddenError,
    NotFoundError,
)
from app.core.riot_api.constants import get_region_by_platform, QueueType
from app.core.riot_api.db_rate_limiter import DBRateLimiter, RateLimitComponent

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

    async def get_player_matches_with_data(
        self,
        puuid: str,
        start: int = 0,
        count: int = 20,
        queue: Optional[int] = None,
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

        Returns:
            MatchListWithPlayerDataResponse with detailed match data
        """
        try:
            # Get matches from database
            db_matches = await self._get_matches_from_db(
                puuid, start, count, queue, None, None
            )

            if not db_matches:
                return MatchListWithPlayerDataResponse(
                    matches=[],
                    total=0,
                    total_analyzed=0,
                    page=0,
                    size=count,
                    pages=0,
                )

            # Get total counts
            total_count = await self._count_matches_from_db(puuid, queue, None, None)
            total_analyzed = await self._count_analyzed_matches_from_db(
                puuid, queue, None, None
            )

            # Get all match IDs
            match_ids = [m.match_id for m in db_matches]

            # Get player's participants for all matches
            player_participants_stmt = select(MatchParticipant).where(
                MatchParticipant.match_id.in_(match_ids),
                MatchParticipant.puuid == puuid,
            )
            player_participants_result = await self.db.execute(player_participants_stmt)
            player_participants_by_match = {
                p.match_id: p for p in player_participants_result.scalars().all()
            }

            # Get all participants for these matches (for finding lane opponents)
            all_participants_stmt = select(MatchParticipant).where(
                MatchParticipant.match_id.in_(match_ids),
            )
            all_participants_result = await self.db.execute(all_participants_stmt)
            all_participants = list(all_participants_result.scalars().all())

            # Group participants by match
            participants_by_match: Dict[str, List[MatchParticipant]] = {}
            for p in all_participants:
                if p.match_id not in participants_by_match:
                    participants_by_match[p.match_id] = []
                participants_by_match[p.match_id].append(p)

            # Get player leagues for LP change calculation (ordered by created_at DESC - newest first)
            leagues_stmt = (
                select(PlayerLeague)
                .where(PlayerLeague.puuid == puuid)
                .order_by(desc(PlayerLeague.created_at))
            )
            leagues_result = await self.db.execute(leagues_stmt)
            player_leagues = list(leagues_result.scalars().all())

            # Build a helper to calculate LP change for a match
            # Logic: Find the league snapshot recorded AFTER the match ended,
            # then compare it to the previous snapshot to get the LP change
            def calculate_lp_change(match_end_timestamp: int) -> int | None:
                """Calculate LP change for a match based on league snapshots.

                Args:
                    match_end_timestamp: The match end timestamp in milliseconds

                Returns:
                    LP change (positive for gain, negative for loss) or None if cannot determine
                """
                if len(player_leagues) < 2:
                    return None

                from datetime import datetime, timezone

                # Convert match timestamp (ms) to datetime
                match_end_dt = datetime.fromtimestamp(
                    match_end_timestamp / 1000, tz=timezone.utc
                )

                # Find the CLOSEST league snapshot AFTER the match ended (this is the "after" snapshot)
                # player_leagues is ordered DESC (newest first), so we iterate from newest to oldest
                # We want the LAST snapshot that is still AFTER the match (closest to match time)
                after_snapshot = None
                before_snapshot = None

                for i, league in enumerate(player_leagues):
                    # Make league.created_at timezone-aware if it isn't
                    league_dt = league.created_at
                    if league_dt.tzinfo is None:
                        league_dt = league_dt.replace(tzinfo=timezone.utc)

                    if league_dt > match_end_dt:
                        # This snapshot is after the match, keep track of it
                        # Continue iterating to find the closest one
                        after_snapshot = league
                        # The next one (older) might be before the match or also after
                        if i + 1 < len(player_leagues):
                            before_snapshot = player_leagues[i + 1]
                        # Don't break - continue to find the closest after_snapshot
                    else:
                        # This snapshot is BEFORE or at the match time
                        # The previous after_snapshot (if any) is the closest one
                        break

                if after_snapshot is None or before_snapshot is None:
                    return None

                # Calculate LP change
                # Need to account for tier/rank changes too
                after_lp = after_snapshot.league_points
                before_lp = before_snapshot.league_points

                # Simple case: same tier and rank
                if (
                    after_snapshot.tier == before_snapshot.tier
                    and after_snapshot.rank == before_snapshot.rank
                ):
                    return after_lp - before_lp

                # If tier or rank changed, we need more complex calculation
                # For now, return the LP difference with a rough estimate
                # (this won't be perfect for promotions/demotions)
                tier_order = [
                    "IRON",
                    "BRONZE",
                    "SILVER",
                    "GOLD",
                    "PLATINUM",
                    "EMERALD",
                    "DIAMOND",
                    "MASTER",
                    "GRANDMASTER",
                    "CHALLENGER",
                ]
                rank_order = ["IV", "III", "II", "I"]  # IV is lowest

                try:
                    after_tier_idx = tier_order.index(after_snapshot.tier.upper())
                    before_tier_idx = tier_order.index(before_snapshot.tier.upper())

                    if after_tier_idx != before_tier_idx:
                        # Tier changed - assume ~100 LP per division
                        tier_diff = after_tier_idx - before_tier_idx
                        # Rough estimate: gained/lost multiple divisions worth of LP
                        return tier_diff * 100 + (after_lp - before_lp)

                    # Same tier, different rank
                    after_rank_idx = (
                        rank_order.index(after_snapshot.rank)
                        if after_snapshot.rank
                        else 0
                    )
                    before_rank_idx = (
                        rank_order.index(before_snapshot.rank)
                        if before_snapshot.rank
                        else 0
                    )
                    rank_diff = after_rank_idx - before_rank_idx

                    # Each rank is roughly 100 LP apart
                    return rank_diff * 100 + (after_lp - before_lp)
                except (ValueError, AttributeError):
                    # Tier not found or other error
                    return after_lp - before_lp

            # Build match responses with player data
            match_responses = []
            for match in db_matches:
                player_participant = player_participants_by_match.get(match.match_id)
                match_participants = participants_by_match.get(match.match_id, [])

                # Find lane opponent
                lane_opponent = None
                if player_participant and player_participant.team_position:
                    for p in match_participants:
                        if (
                            p.puuid != puuid
                            and p.team_id != player_participant.team_id
                            and p.team_position == player_participant.team_position
                        ):
                            opponent_cs = (
                                getattr(p, "total_minions_killed", 0) or 0
                            ) + (getattr(p, "neutral_minions_killed", 0) or 0)
                            lane_opponent = EnemyLaneOpponent(
                                champion_id=p.champion_id,
                                champion_name=p.champion_name,
                                champion_level=p.champion_level,
                                kills=p.kills or 0,
                                deaths=p.deaths or 0,
                                assists=p.assists or 0,
                                kda=float(p.kda) if p.kda else None,
                                total_cs=opponent_cs,
                                vision_score=p.vision_score or 0,
                                total_damage_dealt_to_champions=p.total_damage_dealt_to_champions
                                or 0,
                                summoner1_id=p.summoner1_id,
                                summoner2_id=p.summoner2_id,
                                runes=p.runes,
                            )
                            break

                # Build team compositions and calculate team stats
                # Role order: TOP, JUNGLE, MIDDLE, BOTTOM, UTILITY
                role_order = {
                    "TOP": 0,
                    "JUNGLE": 1,
                    "MIDDLE": 2,
                    "BOTTOM": 3,
                    "UTILITY": 4,
                }
                blue_team = []
                red_team = []
                blue_stats = {
                    "kills": 0,
                    "deaths": 0,
                    "assists": 0,
                    "turrets": None,  # Unknown without timeline data
                    "inhibitors": None,  # Unknown: lostAnInhibitor is per-player takedown stat
                    "dragons": None,  # Unknown without timeline data
                    "barons": 0,
                    "rift_heralds": 0,
                    "voidgrubs": None,  # Unknown: voidMonsterKill is per-player takedown stat
                }
                red_stats = {
                    "kills": 0,
                    "deaths": 0,
                    "assists": 0,
                    "turrets": None,  # Unknown without timeline data
                    "inhibitors": None,  # Unknown: lostAnInhibitor is per-player takedown stat
                    "dragons": None,  # Unknown without timeline data
                    "barons": 0,
                    "rift_heralds": 0,
                    "voidgrubs": None,  # Unknown: voidMonsterKill is per-player takedown stat
                }

                # First pass: aggregate using MAX for shared objectives
                for p in match_participants:
                    team_champ = TeamChampion(
                        champion_id=p.champion_id,
                        champion_name=p.champion_name,
                        team_position=p.team_position,
                        puuid=p.puuid,
                    )

                    # Extract objective stats from advanced_stats
                    advanced = p.advanced_stats or {}
                    # Note: turretTakedowns, dragonTakedowns, lostAnInhibitor, and voidMonsterKill
                    # are per-player participation/takedown stats. Cannot accurately determine
                    # team totals without match_timeline data.
                    team_baron_kills = advanced.get("teamBaronKills", 0) or 0
                    team_rift_herald_kills = advanced.get("teamRiftHeraldKills", 0) or 0

                    if p.team_id == 100:  # Blue team
                        blue_team.append(team_champ)
                        blue_stats["kills"] += p.kills or 0
                        blue_stats["deaths"] += p.deaths or 0
                        blue_stats["assists"] += p.assists or 0
                        # Use MAX for team-wide objective stats
                        blue_stats["barons"] = max(
                            blue_stats["barons"], team_baron_kills
                        )
                        blue_stats["rift_heralds"] = max(
                            blue_stats["rift_heralds"], team_rift_herald_kills
                        )
                    else:  # Red team (200)
                        red_team.append(team_champ)
                        red_stats["kills"] += p.kills or 0
                        red_stats["deaths"] += p.deaths or 0
                        red_stats["assists"] += p.assists or 0
                        # Use MAX for team-wide objective stats
                        red_stats["barons"] = max(red_stats["barons"], team_baron_kills)
                        red_stats["rift_heralds"] = max(
                            red_stats["rift_heralds"], team_rift_herald_kills
                        )

                # Sort by role
                blue_team.sort(key=lambda x: role_order.get(x.team_position or "", 5))
                red_team.sort(key=lambda x: role_order.get(x.team_position or "", 5))

                team_compositions = TeamComposition(
                    blue_team=blue_team,
                    red_team=red_team,
                )

                # Calculate team KDA
                def calc_kda(kills, deaths, assists):
                    if deaths == 0:
                        return float(kills + assists) if kills + assists > 0 else None
                    return round((kills + assists) / deaths, 2)

                team_stats = TeamStatsComposition(
                    blue_team=TeamStats(
                        kills=blue_stats["kills"],
                        deaths=blue_stats["deaths"],
                        assists=blue_stats["assists"],
                        kda=calc_kda(
                            blue_stats["kills"],
                            blue_stats["deaths"],
                            blue_stats["assists"],
                        ),
                        turrets=blue_stats["turrets"],
                        inhibitors=blue_stats["inhibitors"],
                        dragons=blue_stats["dragons"],
                        barons=blue_stats["barons"],
                        rift_heralds=blue_stats["rift_heralds"],
                        voidgrubs=blue_stats["voidgrubs"],
                    ),
                    red_team=TeamStats(
                        kills=red_stats["kills"],
                        deaths=red_stats["deaths"],
                        assists=red_stats["assists"],
                        kda=calc_kda(
                            red_stats["kills"],
                            red_stats["deaths"],
                            red_stats["assists"],
                        ),
                        turrets=red_stats["turrets"],
                        inhibitors=red_stats["inhibitors"],
                        dragons=red_stats["dragons"],
                        barons=red_stats["barons"],
                        rift_heralds=red_stats["rift_heralds"],
                        voidgrubs=red_stats["voidgrubs"],
                    ),
                )

                # Build player participant data
                player_data = None
                if player_participant:
                    total_cs = (
                        getattr(player_participant, "total_minions_killed", 0) or 0
                    ) + (getattr(player_participant, "neutral_minions_killed", 0) or 0)
                    # Also try cs column if available
                    if hasattr(player_participant, "cs") and player_participant.cs:
                        total_cs = player_participant.cs

                    player_data = PlayerMatchParticipant(
                        champion_id=player_participant.champion_id,
                        champion_name=player_participant.champion_name,
                        champion_level=player_participant.champion_level,
                        team_position=player_participant.team_position,
                        team_id=player_participant.team_id,
                        win=player_participant.win,
                        remake=player_participant.remake,
                        kills=player_participant.kills,
                        deaths=player_participant.deaths,
                        assists=player_participant.assists,
                        kda=(
                            float(player_participant.kda)
                            if player_participant.kda
                            else None
                        ),
                        total_cs=total_cs,
                        vision_score=player_participant.vision_score,
                        total_damage_dealt_to_champions=player_participant.total_damage_dealt_to_champions
                        or 0,
                        summoner1_id=player_participant.summoner1_id,
                        summoner2_id=player_participant.summoner2_id,
                        runes=player_participant.runes,
                    )

                # Calculate LP change based on league snapshots
                lp_change = None
                if (
                    match.game_end_timestamp and match.queue_id == 420
                ):  # Only for ranked solo/duo
                    lp_change = calculate_lp_change(match.game_end_timestamp)

                match_response = MatchWithPlayerData(
                    match_id=match.match_id,
                    platform=match.platform,
                    game_start_timestamp=match.game_start_timestamp,
                    game_duration=match.game_duration,
                    queue_id=match.queue_id,
                    game_version=match.game_version,
                    map_id=match.map_id,
                    game_mode=match.game_mode,
                    game_type=match.game_type,
                    game_end_timestamp=match.game_end_timestamp,
                    early_surrender=match.early_surrender,
                    surrender=match.surrender,
                    game_result=match.game_result,
                    fully_analyzed=match.fully_analyzed,
                    created_at=match.created_at,
                    updated_at=match.updated_at,
                    player_participant=player_data,
                    lane_opponent=lane_opponent,
                    lp_change=lp_change,
                    team_compositions=team_compositions,
                    team_stats=team_stats,
                )
                match_responses.append(match_response)

            # Calculate pagination
            page = (start // count) if count > 0 else 0
            pages = ((total_count + count - 1) // count) if count > 0 else 0

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
        self, puuid: str, queue: Optional[int] = None, limit: Optional[int] = None
    ) -> MatchStatsResponse:
        """
        Calculate player statistics from recent matches.

        Args:
            puuid: Player PUUID
            queue: Filter by queue ID
            limit: Number of matches to analyze. If None, analyze all matches.

        Returns:
            MatchStatsResponse with player statistics
        """
        try:
            # If limit is None, get all matches (use a high count)
            fetch_limit = limit if limit is not None else 10000
            # Get recent matches for the player
            matches = await self.get_player_matches(
                puuid, count=fetch_limit, queue=queue
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
        queue: Optional[int] = None,
        limit: int = 20,
    ) -> "ChampionStatsResponse":
        """
        Get player statistics grouped by champion.

        Args:
            puuid: Player PUUID
            queue: Filter by queue ID (e.g., 420 for ranked solo/duo)
            limit: Maximum number of champions to return (sorted by games played)

        Returns:
            ChampionStatsResponse with per-champion statistics
        """
        from .schemas import ChampionStatsResponse, ChampionStatsItem

        try:
            # Build query for participants
            query = select(MatchParticipant).where(MatchParticipant.puuid == puuid)

            # If queue filter, join with matches
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

            # Aggregate stats by champion
            champion_data: dict = {}
            for p in participants:
                champ_name = p.champion_name
                if champ_name not in champion_data:
                    champion_data[champ_name] = {
                        "champion_id": p.champion_id,
                        "games": 0,
                        "wins": 0,
                        "kills": 0,
                        "deaths": 0,
                        "assists": 0,
                    }
                champion_data[champ_name]["games"] += 1
                if p.win:
                    champion_data[champ_name]["wins"] += 1
                champion_data[champ_name]["kills"] += p.kills
                champion_data[champ_name]["deaths"] += p.deaths
                champion_data[champ_name]["assists"] += p.assists

            # Build response items
            champions = []
            for champ_name, data in champion_data.items():
                games = data["games"]
                wins = data["wins"]
                losses = games - wins
                avg_kda = self._calculate_kda(
                    data["kills"], data["deaths"], data["assists"]
                )
                champions.append(
                    ChampionStatsItem(
                        champion_name=champ_name,
                        champion_id=data["champion_id"],
                        games_played=games,
                        wins=wins,
                        losses=losses,
                        win_rate=wins / games if games > 0 else 0.0,
                        avg_kills=data["kills"] / games if games > 0 else 0.0,
                        avg_deaths=data["deaths"] / games if games > 0 else 0.0,
                        avg_assists=data["assists"] / games if games > 0 else 0.0,
                        avg_kda=avg_kda,
                    )
                )

            # Sort by games played descending, limit results
            champions.sort(key=lambda x: x.games_played, reverse=True)
            champions = champions[:limit]

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
        queue: Optional[int] = None,
    ) -> "LaneStatsResponse":
        """
        Get player statistics grouped by lane/position.

        Args:
            puuid: Player PUUID
            queue: Filter by queue ID (e.g., 420 for ranked solo/duo)

        Returns:
            LaneStatsResponse with per-lane statistics
        """
        from .schemas import LaneStatsResponse, LaneStatsItem

        # Lane display name mapping
        lane_names = {
            "TOP": "Top",
            "JUNGLE": "Jungle",
            "MIDDLE": "Mid",
            "BOTTOM": "Bottom",
            "UTILITY": "Support",
        }

        try:
            # Build query for participants
            query = select(MatchParticipant).where(
                MatchParticipant.puuid == puuid,
                MatchParticipant.team_position.isnot(None),
                MatchParticipant.team_position != "",
                MatchParticipant.team_position != "UNKNOWN",
            )

            # If queue filter, join with matches
            if queue is not None:
                query = query.join(
                    Match, MatchParticipant.match_id == Match.match_id
                ).where(Match.queue_id == queue)

            result = await self.db.execute(query)
            participants = result.scalars().all()

            if not participants:
                return LaneStatsResponse(puuid=puuid, total_lanes=0, lanes=[])

            # Aggregate stats by lane
            lane_data: dict = {}
            for p in participants:
                lane = p.team_position
                if lane not in lane_data:
                    lane_data[lane] = {
                        "games": 0,
                        "wins": 0,
                        "kills": 0,
                        "deaths": 0,
                        "assists": 0,
                    }
                lane_data[lane]["games"] += 1
                if p.win:
                    lane_data[lane]["wins"] += 1
                lane_data[lane]["kills"] += p.kills
                lane_data[lane]["deaths"] += p.deaths
                lane_data[lane]["assists"] += p.assists

            # Build response items
            lanes = []
            for lane, data in lane_data.items():
                games = data["games"]
                wins = data["wins"]
                losses = games - wins
                avg_kda = self._calculate_kda(
                    data["kills"], data["deaths"], data["assists"]
                )
                lanes.append(
                    LaneStatsItem(
                        lane=lane_names.get(lane, lane),
                        games_played=games,
                        wins=wins,
                        losses=losses,
                        win_rate=wins / games if games > 0 else 0.0,
                        avg_kills=data["kills"] / games if games > 0 else 0.0,
                        avg_deaths=data["deaths"] / games if games > 0 else 0.0,
                        avg_assists=data["assists"] / games if games > 0 else 0.0,
                        avg_kda=avg_kda,
                    )
                )

            # Sort by games played descending
            lanes.sort(key=lambda x: x.games_played, reverse=True)

            return LaneStatsResponse(
                puuid=puuid,
                total_lanes=len(lane_data),
                lanes=lanes,
            )
        except Exception as e:
            logger.error("Failed to get player lane stats", puuid=puuid, error=str(e))
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
        self, riot_api_client, puuid: str, queue: Optional[int]
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
        Smart match history analysis: fetches only NEW matches and re-analyzes failed ones.

        Workflow:
        1. Get match IDs from Riot API (queue=420, count=100)
        2. Get existing analyzed match IDs from DB for this player
        3. Get match IDs with fully_analyzed=false from DB
        4. Fetch only: (new matches NOT in DB) + (matches with fully_analyzed=false)
        5. Skip Season 15 matches (gameVersion not starting with "16.")

        Args:
            riot_api_client: Initialized client
            puuid: Player PUUID
            progress_callback: Optional async callback(current, total)
            should_cancel: Optional callable returning bool. If True, stops processing.

        Returns:
            Number of matches processed
        """
        import asyncio
        import sys

        try:
            # Check cancel before starting
            if should_cancel and should_cancel():
                logger.info("Analysis cancelled before fetching list", puuid=puuid)
                return 0

            # 1. Get recent match IDs from Riot API
            match_list = await riot_api_client.get_match_list_by_puuid(
                puuid=puuid, count=100, queue=420
            )

            api_match_ids = []
            if match_list:
                if hasattr(match_list, "match_ids"):
                    api_match_ids = list(match_list.match_ids)
                elif isinstance(match_list, list):
                    api_match_ids = match_list

            print(
                f"DEBUG: Riot API returned {len(api_match_ids)} matches for PUUID {puuid}",
                file=sys.stderr,
            )

            if not api_match_ids:
                logger.info("No matches found in Riot API", puuid=puuid)
                return 0

            # 2. Get existing fully analyzed match IDs from DB for this player
            existing_analyzed_stmt = (
                select(Match.match_id)
                .join(MatchParticipant, Match.match_id == MatchParticipant.match_id)
                .where(
                    MatchParticipant.puuid == puuid,
                    Match.fully_analyzed == True,
                )
            )
            result = await self.db.execute(existing_analyzed_stmt)
            existing_analyzed_ids = set(result.scalars().all())

            # 3. Get match IDs that need re-analysis (fully_analyzed=false)
            needs_reanalysis_stmt = (
                select(Match.match_id)
                .join(MatchParticipant, Match.match_id == MatchParticipant.match_id)
                .where(
                    MatchParticipant.puuid == puuid,
                    Match.fully_analyzed == False,
                )
            )
            result = await self.db.execute(needs_reanalysis_stmt)
            needs_reanalysis_ids = set(result.scalars().all())

            # 4. Calculate matches to fetch:
            #    - New matches: in API list but NOT in our fully analyzed set
            #    - Plus: any that need re-analysis
            new_match_ids = [
                mid for mid in api_match_ids if mid not in existing_analyzed_ids
            ]

            # Combine: new + needs_reanalysis (deduplicate)
            matches_to_process = list(set(new_match_ids) | needs_reanalysis_ids)

            # Preserve order from API (newer first) for new matches
            ordered_to_process = [
                mid for mid in api_match_ids if mid in matches_to_process
            ]
            # Add any needs_reanalysis that weren't in API list (unlikely but possible)
            for mid in needs_reanalysis_ids:
                if mid not in ordered_to_process:
                    ordered_to_process.append(mid)

            logger.info(
                "Smart match analysis starting",
                puuid=puuid,
                api_matches=len(api_match_ids),
                already_analyzed=len(existing_analyzed_ids),
                new_matches=len(new_match_ids),
                needs_reanalysis=len(needs_reanalysis_ids),
                to_process=len(ordered_to_process),
            )

            print(
                f"DEBUG: Processing {len(ordered_to_process)} matches "
                f"({len(new_match_ids)} new, {len(needs_reanalysis_ids)} re-analysis)",
                file=sys.stderr,
            )

            if not ordered_to_process:
                logger.info("No new or incomplete matches to process", puuid=puuid)
                if progress_callback:
                    await progress_callback(0, 0)
                return 0

            processed = 0
            skipped_season = 0
            total = len(ordered_to_process)

            for i, match_id in enumerate(ordered_to_process):
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
                    await progress_callback(i, total)

                # STRICT THROTTLING: 1.2s delay to respect 100 req/2min Dev Key limit
                await asyncio.sleep(1.2)

                try:
                    # Fetch match details
                    match_dto = await riot_api_client.get_match(match_id)
                    if not match_dto:
                        continue

                    # Season 16 filter: skip matches from Season 15 (Task 1)
                    game_version = match_dto.info.game_version
                    if not game_version.startswith("16."):
                        logger.debug(
                            "Skipping Season 15 match",
                            match_id=match_id,
                            game_version=game_version,
                        )
                        skipped_season += 1
                        continue

                    # Reprocess (Upsert)
                    await self._reprocess_match(match_dto)
                    processed += 1
                except Exception as e:
                    logger.error(
                        "Failed to process match", match_id=match_id, error=str(e)
                    )
                    # Continue with next match

            # Final progress update
            if progress_callback:
                await progress_callback(total, total)

            logger.info(
                "Match analysis completed",
                puuid=puuid,
                processed=processed,
                skipped_season=skipped_season,
            )

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
                # Check if player already exists to preserve is_tracked status
                existing_player_result = await self.db.execute(
                    select(Player).where(Player.puuid == participant.puuid)
                )
                existing_player = existing_player_result.scalar_one_or_none()

                player_record = Player(
                    puuid=participant.puuid,
                    game_name=p_game_name,
                    tag_line=p_tag_line,
                    platform=platform_id.lower(),
                    profile_icon_id=participant.profile_icon
                    or 29,  # Default icon if missing
                    summoner_level=participant.summoner_level
                    or 0,  # Default level if missing
                    # Preserve is_tracked if player exists, otherwise default to False
                    is_tracked=existing_player.is_tracked if existing_player else False,
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

    async def sync_matches_for_player(
        self,
        riot_client: "RiotAPIClient",
        player: Any,
        rate_limiter: Optional[DBRateLimiter] = None,
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
        start = 0
        count = 100
        total_stored = 0
        keep_fetching = True

        # Track updated game name/tag if retrieved from API
        updated_game_name = None
        updated_tag_line = None

        logger.info("Starting match sync", puuid=puuid, platform=platform)

        while keep_fetching:
            try:
                # Use DB rate limiter if provided
                if rate_limiter:
                    can_proceed = await rate_limiter.acquire()
                    if not can_proceed:
                        logger.warning(
                            "Rate limit exceeded, stopping match sync",
                            puuid=puuid,
                        )
                        break

                # 1. Fetch match IDs
                match_list_dto = await riot_client.get_match_list_by_puuid(
                    puuid=puuid,
                    region=region,
                    start=start,
                    count=count,
                    queue=QueueType.RANKED_SOLO_5X5,
                )

                # Record the request if using rate limiter
                if rate_limiter:
                    await rate_limiter.record_request()

            except Exception as e:
                logger.error("Failed to fetch match IDs", puuid=puuid, error=str(e))
                break

            if not match_list_dto or not match_list_dto.match_ids:
                break

            ids_list = match_list_dto.match_ids

            stmt = select(Match.match_id).where(
                Match.match_id.in_(ids_list), Match.fully_analyzed == True
            )
            result = await self.db.execute(stmt)
            analyzed_ids = set(result.scalars().all())

            # Process matches that are either NEW or NOT FULLY ANALYZED
            ids_to_process = [mid for mid in ids_list if mid not in analyzed_ids]

            for match_id in ids_to_process:
                try:
                    # Use DB rate limiter for coordinated rate limiting
                    if rate_limiter:
                        can_proceed = await rate_limiter.acquire()
                        if not can_proceed:
                            logger.warning(
                                "Rate limit exceeded during match fetch",
                                puuid=puuid,
                                match_id=match_id,
                            )
                            keep_fetching = False
                            break

                    # 2. Fetch match details
                    match_dto = await riot_client.get_match(match_id, region=region)

                    # Record the request if using rate limiter
                    if rate_limiter:
                        await rate_limiter.record_request()

                    if not match_dto:
                        continue

                    if not match_dto.info.game_version.startswith("16."):
                        keep_fetching = False
                        break

                    # Use reprocess to ensure fully_analyzed=True and consistent logic
                    await self._reprocess_match(match_dto)
                    # _reprocess_match commits internally

                    total_stored += 1

                except Exception as e:
                    logger.warning(
                        "Error syncing match", match_id=match_id, error=str(e)
                    )
                    continue

            if not keep_fetching or len(ids_list) < count:
                break

            start += count

        return total_stored
