"""Private helpers extracted from MatchService to keep cyclomatic complexity low."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any, Callable, Dict, List, Optional, Protocol, cast

import structlog
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.player_identity import resolve_player_display_fields
from app.core.riot_api.db_rate_limiter import DBRateLimiter
from app.core.riot_api.errors import AuthenticationError, ForbiddenError, RateLimitError
from app.features.players.leagues import PlayerLeague
from app.features.players.models import Player

from .lane import opposing_lane_participant
from .models import Match
from .participants import MatchParticipant
from .schemas import (
    ChampionStatsItem,
    EnemyLaneOpponent,
    LaneStatsItem,
    MatchWithPlayerData,
    PlayerMatchParticipant,
    TeamChampion,
    TeamComposition,
    TeamStats,
    TeamStatsComposition,
)
from .timeline import MatchTimeline, replace_match_timeline_rows

logger = structlog.get_logger("app.features.matches.service")

ROLE_ORDER: dict[str, int] = {
    "TOP": 0,
    "JUNGLE": 1,
    "MIDDLE": 2,
    "BOTTOM": 3,
    "UTILITY": 4,
}
LANE_DISPLAY_NAMES: dict[str, str] = {
    "TOP": "Top",
    "JUNGLE": "Jungle",
    "MIDDLE": "Mid",
    "BOTTOM": "Bottom",
    "UTILITY": "Support",
}
TIER_ORDER: list[str] = [
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
RANK_ORDER: list[str] = ["IV", "III", "II", "I"]
AnalysisMatchResult = str
OnFailure = Optional[Callable[[str, Exception, dict[str, Any]], None]]


class EnsureMaintenance(Protocol):
    async def __call__(self, session: AsyncSession) -> None: ...


class ReprocessMatch(Protocol):
    async def __call__(
        self,
        match_dto: Any,
        timeline_payload: Optional[Dict[str, Any]] = None,
    ) -> None: ...


def must_abort_writer_sync(error: Exception) -> bool:
    """Return whether a lower-level sync error must reach the owning job."""
    from app.features.jobs.error_handling import is_database_job_error
    from app.features.jobs.maintenance import RiotWriterMaintenanceActiveError

    return is_database_job_error(error) or isinstance(
        error, RiotWriterMaintenanceActiveError
    )


def calculate_kda(kills: int, deaths: int, assists: int) -> float:
    """Calculate KDA ratio."""
    if deaths == 0:
        return float(kills + assists)
    return (kills + assists) / deaths


def or_zero(value: Any) -> int:
    """Coerce a missing or falsey numeric field to 0."""
    return value or 0


def advanced_int(advanced_stats: Any, key: str) -> int:
    """Safely read integer-like advanced_stats values."""
    if not isinstance(advanced_stats, dict):
        return 0
    raw_value = advanced_stats.get(key, 0)
    if raw_value is None:
        return 0
    try:
        return int(raw_value)
    except TypeError, ValueError:
        return 0


def page_window(start: int, count: int, total_count: int) -> tuple[int, int]:
    """Convert start/count pagination into page and page-count."""
    if count > 0:
        return start // count, (total_count + count - 1) // count
    return 0, 0


def group_participants_by_match(
    all_participants: List[MatchParticipant],
) -> Dict[str, List[MatchParticipant]]:
    """Group participant rows by match ID."""
    participants_by_match: Dict[str, List[MatchParticipant]] = {}
    for participant in all_participants:
        if participant.match_id not in participants_by_match:
            participants_by_match[participant.match_id] = []
        participants_by_match[participant.match_id].append(participant)
    return participants_by_match


def index_timelines_by_match_team(
    timeline_rows: List[MatchTimeline],
) -> Dict[str, Dict[int, MatchTimeline]]:
    """Index one timeline row per team for each match."""
    timelines_by_match_team: Dict[str, Dict[int, MatchTimeline]] = {}
    for timeline_row in timeline_rows:
        match_teams = timelines_by_match_team.setdefault(timeline_row.match_id, {})
        if timeline_row.team_id not in match_teams:
            match_teams[timeline_row.team_id] = timeline_row
    return timelines_by_match_team


def _league_datetime(league: PlayerLeague) -> datetime:
    league_dt = league.created_at
    if league_dt.tzinfo is None:
        league_dt = league_dt.replace(tzinfo=timezone.utc)
    return league_dt


def find_lp_snapshots(
    player_leagues: List[PlayerLeague],
    match_end_dt: datetime,
) -> tuple[Optional[PlayerLeague], Optional[PlayerLeague]]:
    """Find the closest after-match snapshot and the snapshot immediately before it."""
    after_snapshot: Optional[PlayerLeague] = None
    before_snapshot: Optional[PlayerLeague] = None
    for index, league in enumerate(player_leagues):
        if _league_datetime(league) > match_end_dt:
            after_snapshot = league
            if index + 1 < len(player_leagues):
                before_snapshot = player_leagues[index + 1]
            continue
        break
    return after_snapshot, before_snapshot


def _rank_index(rank: Optional[str]) -> int:
    if rank:
        return RANK_ORDER.index(rank)
    return 0


def lp_change_across_ranks(
    after_snapshot: PlayerLeague,
    before_snapshot: PlayerLeague,
) -> int:
    """Estimate LP change, including a rough promotion/demotion adjustment."""
    after_lp = after_snapshot.league_points
    before_lp = before_snapshot.league_points
    if (
        after_snapshot.tier == before_snapshot.tier
        and after_snapshot.rank == before_snapshot.rank
    ):
        return after_lp - before_lp
    try:
        after_tier_idx = TIER_ORDER.index(after_snapshot.tier.upper())
        before_tier_idx = TIER_ORDER.index(before_snapshot.tier.upper())
        if after_tier_idx != before_tier_idx:
            return (after_tier_idx - before_tier_idx) * 100 + (after_lp - before_lp)
        rank_diff = _rank_index(after_snapshot.rank) - _rank_index(before_snapshot.rank)
        return rank_diff * 100 + (after_lp - before_lp)
    except ValueError, AttributeError:
        return after_lp - before_lp


def calculate_lp_change(
    player_leagues: List[PlayerLeague],
    match_end_timestamp: int,
) -> Optional[int]:
    """Calculate LP change for a match based on league snapshots."""
    if len(player_leagues) < 2:
        return None
    match_end_dt = datetime.fromtimestamp(match_end_timestamp / 1000, tz=timezone.utc)
    after_snapshot, before_snapshot = find_lp_snapshots(player_leagues, match_end_dt)
    if after_snapshot is None or before_snapshot is None:
        return None
    return lp_change_across_ranks(after_snapshot, before_snapshot)


def match_lp_change(match: Match, player_leagues: List[PlayerLeague]) -> Optional[int]:
    """LP change is only derived for ranked solo/duo matches with an end time."""
    if match.game_end_timestamp and match.queue_id == 420:
        return calculate_lp_change(player_leagues, match.game_end_timestamp)
    return None


def find_lane_opponent(
    puuid: str,
    player_participant: Optional[MatchParticipant],
    match_participants: List[MatchParticipant],
) -> Optional[EnemyLaneOpponent]:
    """Return the opposing player in the same assigned lane, if any."""
    if not player_participant:
        return None
    opponent = opposing_lane_participant(player_participant, match_participants)
    if opponent is None:
        return None
    return _enemy_lane_opponent(opponent)


def _enemy_lane_opponent(participant: MatchParticipant) -> EnemyLaneOpponent:
    opponent_cs = or_zero(getattr(participant, "total_minions_killed", 0)) + or_zero(
        getattr(participant, "neutral_minions_killed", 0)
    )
    return EnemyLaneOpponent(
        champion_id=participant.champion_id,
        champion_name=participant.champion_name,
        champion_level=participant.champion_level,
        kills=participant.kills or 0,
        deaths=participant.deaths or 0,
        assists=participant.assists or 0,
        kda=float(participant.kda) if participant.kda else None,
        total_cs=opponent_cs,
        vision_score=participant.vision_score or 0,
        total_damage_dealt_to_champions=participant.total_damage_dealt_to_champions
        or 0,
        summoner1_id=participant.summoner1_id,
        summoner2_id=participant.summoner2_id,
        runes=cast(Any, participant.runes),
    )


def timeline_int_or_none(timeline: Optional[MatchTimeline], attr: str) -> Optional[int]:
    if timeline is None:
        return None
    return getattr(timeline, attr)


def timeline_int_or_zero(timeline: Optional[MatchTimeline], attr: str) -> int:
    if timeline is None:
        return 0
    return getattr(timeline, attr)


def empty_team_stats(timeline: Optional[MatchTimeline]) -> dict[str, Any]:
    """Seed team objective totals from timeline rows when they exist."""
    return {
        "kills": 0,
        "deaths": 0,
        "assists": 0,
        "turrets": timeline_int_or_none(timeline, "team_turrets_destroyed"),
        "inhibitors": timeline_int_or_none(timeline, "team_inhibitors_destroyed"),
        "dragons": timeline_int_or_none(timeline, "team_dragons_slain"),
        "barons": timeline_int_or_zero(timeline, "team_barons_slain"),
        "rift_heralds": timeline_int_or_zero(timeline, "team_rift_heralds_slain"),
        "voidgrubs": timeline_int_or_none(timeline, "team_voidgrubs_slain"),
    }


def participant_objective_counts(
    participant: MatchParticipant,
) -> tuple[int, int, int, int]:
    """Read baron/herald/dragon/void-monster fallbacks from advanced_stats."""
    advanced = participant.advanced_stats or {}
    return (
        advanced_int(advanced, "teamBaronKills"),
        advanced_int(advanced, "teamRiftHeraldKills"),
        advanced_int(advanced, "dragonTakedowns"),
        advanced_int(advanced, "voidMonsterKill"),
    )


def add_combat_totals(stats: dict[str, Any], participant: MatchParticipant) -> None:
    stats["kills"] += or_zero(participant.kills)
    stats["deaths"] += or_zero(participant.deaths)
    stats["assists"] += or_zero(participant.assists)


def apply_participant_objective_fallback(
    stats: dict[str, Any],
    participant: MatchParticipant,
    dragon_takedowns: int,
    team_baron_kills: int,
    team_rift_herald_kills: int,
    void_monster_kills: int,
    void_monster_max: int,
) -> int:
    """Accumulate participant-level objective fallbacks when timeline data is missing."""
    stats["turrets"] = or_zero(stats["turrets"]) + or_zero(participant.turret_kills)
    stats["inhibitors"] = or_zero(stats["inhibitors"]) + or_zero(
        participant.inhibitor_kills
    )
    stats["dragons"] = max(or_zero(stats["dragons"]), dragon_takedowns)
    stats["barons"] = max(stats["barons"], team_baron_kills)
    stats["rift_heralds"] = max(stats["rift_heralds"], team_rift_herald_kills)
    return max(void_monster_max, void_monster_kills)


def accumulate_team_participant(
    participant: MatchParticipant,
    blue_team: List[TeamChampion],
    red_team: List[TeamChampion],
    blue_stats: dict[str, Any],
    red_stats: dict[str, Any],
    blue_has_timeline: bool,
    red_has_timeline: bool,
    blue_void_monster_max: int,
    red_void_monster_max: int,
) -> tuple[int, int]:
    """Add one participant to the matching team's composition and running totals."""
    team_champ = TeamChampion(
        champion_id=participant.champion_id,
        champion_name=participant.champion_name,
        team_position=participant.team_position,
        puuid=participant.puuid,
    )
    (
        team_baron_kills,
        team_rift_herald_kills,
        dragon_takedowns,
        void_monster_kills,
    ) = participant_objective_counts(participant)
    if participant.team_id == 100:
        blue_team.append(team_champ)
        add_combat_totals(blue_stats, participant)
        if not blue_has_timeline:
            blue_void_monster_max = apply_participant_objective_fallback(
                blue_stats,
                participant,
                dragon_takedowns,
                team_baron_kills,
                team_rift_herald_kills,
                void_monster_kills,
                blue_void_monster_max,
            )
        return blue_void_monster_max, red_void_monster_max
    red_team.append(team_champ)
    add_combat_totals(red_stats, participant)
    if not red_has_timeline:
        red_void_monster_max = apply_participant_objective_fallback(
            red_stats,
            participant,
            dragon_takedowns,
            team_baron_kills,
            team_rift_herald_kills,
            void_monster_kills,
            red_void_monster_max,
        )
    return blue_void_monster_max, red_void_monster_max


def apply_voidgrub_fallback(
    stats: dict[str, Any],
    void_monster_max: int,
    has_timeline: bool,
) -> None:
    """Derive voidgrubs from combined void-monster stats when timeline is absent."""
    if has_timeline:
        return
    stats["voidgrubs"] = max(
        0,
        void_monster_max - stats["barons"] - stats["rift_heralds"],
    )


def calc_team_kda(kills: int, deaths: int, assists: int) -> Optional[float]:
    """Team KDA is None when the team has no kills, deaths, or assists."""
    if deaths == 0:
        return float(kills + assists) if kills + assists > 0 else None
    return round((kills + assists) / deaths, 2)


def compose_team_stats(stats: dict[str, Any]) -> TeamStats:
    return TeamStats(
        kills=stats["kills"],
        deaths=stats["deaths"],
        assists=stats["assists"],
        kda=calc_team_kda(stats["kills"], stats["deaths"], stats["assists"]),
        turrets=stats["turrets"],
        inhibitors=stats["inhibitors"],
        dragons=stats["dragons"],
        barons=stats["barons"],
        rift_heralds=stats["rift_heralds"],
        voidgrubs=stats["voidgrubs"],
    )


def role_sort_key(champion: TeamChampion) -> int:
    return ROLE_ORDER.get(champion.team_position or "", 5)


def build_team_compositions_and_stats(
    match_participants: List[MatchParticipant],
    timeline_by_team: Dict[int, MatchTimeline],
) -> tuple[TeamComposition, TeamStatsComposition]:
    """Build both team compositions and aggregated team statistics."""
    blue_team: List[TeamChampion] = []
    red_team: List[TeamChampion] = []
    blue_timeline = timeline_by_team.get(100)
    red_timeline = timeline_by_team.get(200)
    blue_has_timeline = blue_timeline is not None
    red_has_timeline = red_timeline is not None
    blue_stats = empty_team_stats(blue_timeline)
    red_stats = empty_team_stats(red_timeline)
    blue_void_monster_max = 0
    red_void_monster_max = 0
    for participant in match_participants:
        blue_void_monster_max, red_void_monster_max = accumulate_team_participant(
            participant,
            blue_team,
            red_team,
            blue_stats,
            red_stats,
            blue_has_timeline,
            red_has_timeline,
            blue_void_monster_max,
            red_void_monster_max,
        )
    apply_voidgrub_fallback(blue_stats, blue_void_monster_max, blue_has_timeline)
    apply_voidgrub_fallback(red_stats, red_void_monster_max, red_has_timeline)
    blue_team.sort(key=role_sort_key)
    red_team.sort(key=role_sort_key)
    return (
        TeamComposition(blue_team=blue_team, red_team=red_team),
        TeamStatsComposition(
            blue_team=compose_team_stats(blue_stats),
            red_team=compose_team_stats(red_stats),
        ),
    )


def player_total_cs(participant: MatchParticipant) -> int:
    """Prefer the dedicated CS column when it is populated."""
    total_cs = or_zero(getattr(participant, "total_minions_killed", 0)) + or_zero(
        getattr(participant, "neutral_minions_killed", 0)
    )
    if hasattr(participant, "cs") and participant.cs:
        return participant.cs
    return total_cs


def build_player_match_participant(
    player_participant: Optional[MatchParticipant],
) -> Optional[PlayerMatchParticipant]:
    """Build the focused player card for a match list row."""
    if not player_participant:
        return None
    return PlayerMatchParticipant(
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
        kda=(float(player_participant.kda) if player_participant.kda else None),
        total_cs=player_total_cs(player_participant),
        vision_score=player_participant.vision_score,
        total_damage_dealt_to_champions=player_participant.total_damage_dealt_to_champions
        or 0,
        summoner1_id=player_participant.summoner1_id,
        summoner2_id=player_participant.summoner2_id,
        runes=cast(Any, player_participant.runes),
    )


def build_match_with_player_data(
    match: Match,
    player_data: Optional[PlayerMatchParticipant],
    lane_opponent: Optional[EnemyLaneOpponent],
    lp_change: Optional[int],
    team_compositions: TeamComposition,
    team_stats: TeamStatsComposition,
) -> MatchWithPlayerData:
    return MatchWithPlayerData(
        match_id=match.match_id,
        platform=match.platform,
        game_creation_timestamp=match.game_creation_timestamp,
        game_start_timestamp=match.game_start_timestamp,
        game_start_timestamp_source=match.game_start_timestamp_source,
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


def build_match_responses(
    db_matches: List[Match],
    player_participants_by_match: Dict[str, MatchParticipant],
    participants_by_match: Dict[str, List[MatchParticipant]],
    timelines_by_match_team: Dict[str, Dict[int, MatchTimeline]],
    player_leagues: List[PlayerLeague],
    puuid: str,
) -> List[MatchWithPlayerData]:
    """Assemble the per-match player-data payload for a history page."""
    match_responses: List[MatchWithPlayerData] = []
    for match in db_matches:
        player_participant = player_participants_by_match.get(match.match_id)
        match_participants = participants_by_match.get(match.match_id, [])
        team_compositions, team_stats = build_team_compositions_and_stats(
            match_participants,
            timelines_by_match_team.get(match.match_id, {}),
        )
        match_responses.append(
            build_match_with_player_data(
                match,
                build_player_match_participant(player_participant),
                find_lane_opponent(puuid, player_participant, match_participants),
                match_lp_change(match, player_leagues),
                team_compositions,
                team_stats,
            )
        )
    return match_responses


async def load_match_player_data_context(
    session: AsyncSession,
    puuid: str,
    match_ids: List[str],
) -> tuple[
    Dict[str, MatchParticipant],
    Dict[str, List[MatchParticipant]],
    Dict[str, Dict[int, MatchTimeline]],
    List[PlayerLeague],
]:
    """Load participants, timeline aggregates, and league snapshots for a page."""
    player_participants_result = await session.execute(
        select(MatchParticipant).where(
            MatchParticipant.match_id.in_(match_ids),
            MatchParticipant.puuid == puuid,
        )
    )
    player_participants_by_match = {
        participant.match_id: participant
        for participant in player_participants_result.scalars().all()
    }
    all_participants_result = await session.execute(
        select(MatchParticipant).where(MatchParticipant.match_id.in_(match_ids))
    )
    timeline_result = await session.execute(
        select(MatchTimeline).where(MatchTimeline.match_id.in_(match_ids))
    )
    leagues_result = await session.execute(
        select(PlayerLeague)
        .where(PlayerLeague.puuid == puuid)
        .order_by(desc(PlayerLeague.created_at))
    )
    return (
        player_participants_by_match,
        group_participants_by_match(list(all_participants_result.scalars().all())),
        index_timelines_by_match_team(list(timeline_result.scalars().all())),
        list(leagues_result.scalars().all()),
    )


def accumulate_champion_stats(participants: Any) -> dict[str, dict[str, int]]:
    """Aggregate combat stats grouped by champion name."""
    champion_data: dict[str, dict[str, int]] = {}
    for participant in participants:
        champ_name = participant.champion_name
        if champ_name not in champion_data:
            champion_data[champ_name] = {
                "champion_id": participant.champion_id,
                "games": 0,
                "wins": 0,
                "kills": 0,
                "deaths": 0,
                "assists": 0,
            }
        champion_data[champ_name]["games"] += 1
        if participant.win:
            champion_data[champ_name]["wins"] += 1
        champion_data[champ_name]["kills"] += participant.kills
        champion_data[champ_name]["deaths"] += participant.deaths
        champion_data[champ_name]["assists"] += participant.assists
    return champion_data


def accumulate_lane_stats(participants: Any) -> dict[str, dict[str, int]]:
    """Aggregate combat stats grouped by assigned lane."""
    lane_data: dict[str, dict[str, int]] = {}
    for participant in participants:
        lane = participant.team_position
        if not lane:
            continue
        if lane not in lane_data:
            lane_data[lane] = {
                "games": 0,
                "wins": 0,
                "kills": 0,
                "deaths": 0,
                "assists": 0,
            }
        lane_data[lane]["games"] += 1
        if participant.win:
            lane_data[lane]["wins"] += 1
        lane_data[lane]["kills"] += participant.kills
        lane_data[lane]["deaths"] += participant.deaths
        lane_data[lane]["assists"] += participant.assists
    return lane_data


def averages_from_totals(
    data: dict[str, int],
) -> tuple[int, int, int, float, float, float, float, float]:
    """Turn accumulated combat totals into per-game averages."""
    games = data["games"]
    wins = data["wins"]
    losses = games - wins
    avg_kda = calculate_kda(data["kills"], data["deaths"], data["assists"])
    if games > 0:
        return (
            games,
            wins,
            losses,
            wins / games,
            data["kills"] / games,
            data["deaths"] / games,
            data["assists"] / games,
            avg_kda,
        )
    return games, wins, losses, 0.0, 0.0, 0.0, 0.0, avg_kda


def champion_stats_sort_key(champion: ChampionStatsItem) -> tuple[int, str]:
    return (-champion.games_played, champion.champion_name)


def build_champion_stat_items(
    champion_data: dict[str, dict[str, int]],
) -> List[ChampionStatsItem]:
    """Build the complete ordered champion-statistics population."""
    champions: List[ChampionStatsItem] = []
    for champ_name, data in champion_data.items():
        games, wins, losses, win_rate, avg_kills, avg_deaths, avg_assists, avg_kda = (
            averages_from_totals(data)
        )
        champions.append(
            ChampionStatsItem(
                champion_name=champ_name,
                champion_id=data["champion_id"],
                games_played=games,
                wins=wins,
                losses=losses,
                win_rate=win_rate,
                avg_kills=avg_kills,
                avg_deaths=avg_deaths,
                avg_assists=avg_assists,
                avg_kda=avg_kda,
            )
        )
    champions.sort(key=champion_stats_sort_key)
    return champions


def build_lane_stat_items(lane_data: dict[str, dict[str, int]]) -> List[LaneStatsItem]:
    """Build per-lane statistics sorted by games played."""
    lanes: List[LaneStatsItem] = []
    for lane, data in lane_data.items():
        games, wins, losses, win_rate, avg_kills, avg_deaths, avg_assists, avg_kda = (
            averages_from_totals(data)
        )
        lanes.append(
            LaneStatsItem(
                lane=LANE_DISPLAY_NAMES.get(lane, lane),
                games_played=games,
                wins=wins,
                losses=losses,
                win_rate=win_rate,
                avg_kills=avg_kills,
                avg_deaths=avg_deaths,
                avg_assists=avg_assists,
                avg_kda=avg_kda,
            )
        )
    lanes.sort(key=lambda item: item.games_played, reverse=True)
    return lanes


def extract_store_participant_identity(participant: Any) -> dict[str, Any]:
    """Normalize a match DTO participant into the player-row identity fields."""
    game_name = participant.game_name or participant.summoner_name or "Unknown"
    tag_line = participant.tag_line
    if not tag_line and "#" in game_name:
        game_name, tag_line = game_name.split("#", 1)
    return {
        "puuid": participant.puuid,
        "game_name": game_name,
        "tag_line": tag_line or "RIOT",
        "summoner_level": participant.summoner_level,
        "profile_icon_id": getattr(participant, "profile_icon", 29),
    }


def match_end_flags(participants: Any) -> tuple[bool, bool]:
    """Derive early-surrender and surrender flags from participant DTOs."""
    early_surrender = any(
        participant.game_ended_in_early_surrender for participant in participants
    )
    surrender = any(participant.game_ended_in_surrender for participant in participants)
    return early_surrender, surrender


def match_dto_id(match_dto: Any) -> str:
    if hasattr(match_dto, "metadata"):
        return match_dto.metadata.match_id
    return "unknown"


def build_match_record(
    match_dto: Any,
    platform_id: str,
    early_surrender: bool,
    surrender: bool,
    *,
    fully_analyzed: Optional[bool] = None,
) -> Match:
    """Build a Match row from a Riot match DTO."""
    match = Match(
        match_id=match_dto.metadata.match_id,
        platform=platform_id.upper(),
        game_creation_timestamp=match_dto.info.game_creation_timestamp,
        game_start_timestamp=match_dto.info.game_start_timestamp,
        game_start_timestamp_source="riot_game_start",
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
    if fully_analyzed is not None:
        match.fully_analyzed = fully_analyzed
    return match


def add_participants_from_dto(session: AsyncSession, match_dto: Any) -> None:
    """Stage MatchParticipant rows from a Riot match DTO."""
    from .transformers import MatchDTOTransformer

    for participant in match_dto.info.participants:
        participant_data = MatchDTOTransformer.extract_participant_data(participant)
        session.add(
            MatchParticipant(
                match_id=match_dto.metadata.match_id,
                **participant_data,
            )
        )


def resolve_reprocess_player_fields(
    participant: Any,
    existing_player: Optional[Player],
    platform_id: str,
) -> dict[str, Any]:
    """Preserve known identity fields when a Riot participant payload is incomplete."""
    return resolve_player_display_fields(participant, existing_player, platform_id)


async def merge_reprocess_player(
    session: AsyncSession,
    participant: Any,
    platform_id: str,
) -> None:
    """Upsert the skeletal player row required by the match-participant FK."""
    existing_player_result = await session.execute(
        select(Player).where(Player.puuid == participant.puuid)
    )
    existing_player = existing_player_result.scalar_one_or_none()
    fields = resolve_reprocess_player_fields(participant, existing_player, platform_id)
    await session.merge(
        Player(
            puuid=participant.puuid,
            game_name=fields["game_name"],
            tag_line=fields["tag_line"],
            platform=platform_id.lower(),
            profile_icon_id=fields["profile_icon_id"],
            summoner_level=fields["summoner_level"],
            is_tracked=fields["is_tracked"],
        )
    )


async def merge_reprocess_participants(
    session: AsyncSession,
    match_dto: Any,
    match_id: str,
    platform_id: str,
) -> None:
    """Upsert every participant player and match-participant row for a rematch."""
    from .transformers import MatchDTOTransformer

    for participant in match_dto.info.participants:
        await merge_reprocess_player(session, participant, platform_id)
        participant_data = MatchDTOTransformer.extract_participant_data(participant)
        await session.merge(
            MatchParticipant(
                match_id=match_id,
                **participant_data,
            )
        )


def extract_queue_match_ids(match_list: Any) -> List[str]:
    """Accept both DTO objects and bare match-id lists from the Riot client."""
    if not match_list:
        return []
    if hasattr(match_list, "match_ids"):
        return list(match_list.match_ids)
    if isinstance(match_list, list):
        return match_list
    return []


def append_unique_match_ids(
    api_match_ids: List[str],
    seen_match_ids: set[str],
    queue_match_ids: List[str],
) -> None:
    """Preserve first-seen order while merging per-queue match IDs."""
    for match_id in queue_match_ids:
        if match_id in seen_match_ids:
            continue
        seen_match_ids.add(match_id)
        api_match_ids.append(match_id)


async def collect_analysis_api_match_ids(
    riot_api_client: Any,
    puuid: str,
    target_queue_ids: List[int],
    rate_limiter: Optional[DBRateLimiter],
) -> List[str]:
    """Fetch recent match IDs for each requested queue, stopping on rate limits."""
    api_match_ids: List[str] = []
    seen_match_ids: set[str] = set()
    for queue_id in target_queue_ids:
        if rate_limiter:
            can_proceed = await rate_limiter.acquire()
            if not can_proceed:
                logger.warning(
                    "Rate limit reached before match-list fetch in analysis",
                    puuid=puuid,
                    queue_id=queue_id,
                )
                break
        match_list_requested = False
        match_list = await riot_api_client.get_match_list_by_puuid(
            puuid=puuid, count=100, queue=queue_id
        )
        match_list_requested = True
        if rate_limiter and match_list_requested:
            await rate_limiter.record_request()
        append_unique_match_ids(
            api_match_ids,
            seen_match_ids,
            extract_queue_match_ids(match_list),
        )
    return api_match_ids


async def load_analysis_process_sets(
    session: AsyncSession,
    puuid: str,
    api_match_ids: List[str],
) -> tuple[List[str], set[str], set[str], set[str]]:
    """Load analyzed, incomplete, and missing-timeline sets for smart analysis."""
    existing_analyzed_result = await session.execute(
        select(Match.match_id)
        .join(MatchParticipant, Match.match_id == MatchParticipant.match_id)
        .where(
            MatchParticipant.puuid == puuid,
            Match.fully_analyzed.is_(True),
        )
    )
    existing_analyzed_ids = set(existing_analyzed_result.scalars().all())
    needs_reanalysis_result = await session.execute(
        select(Match.match_id)
        .join(MatchParticipant, Match.match_id == MatchParticipant.match_id)
        .where(
            MatchParticipant.puuid == puuid,
            Match.fully_analyzed.is_(False),
        )
    )
    needs_reanalysis_ids = set(needs_reanalysis_result.scalars().all())
    new_match_ids = [
        match_id for match_id in api_match_ids if match_id not in existing_analyzed_ids
    ]
    existing_timeline_result = await session.execute(
        select(MatchTimeline.match_id).where(
            MatchTimeline.match_id.in_(api_match_ids),
            MatchTimeline.puuid == puuid,
        )
    )
    timeline_present_ids = set(existing_timeline_result.scalars().all())
    missing_timeline_ids = {
        match_id for match_id in api_match_ids if match_id not in timeline_present_ids
    }
    return (
        new_match_ids,
        existing_analyzed_ids,
        needs_reanalysis_ids,
        missing_timeline_ids,
    )


def order_analysis_matches(
    api_match_ids: List[str],
    new_match_ids: List[str],
    needs_reanalysis_ids: set[str],
    missing_timeline_ids: set[str],
) -> List[str]:
    """Prefer Riot's newest-first order, then append leftover incomplete IDs."""
    matches_to_process = (
        set(new_match_ids) | needs_reanalysis_ids | missing_timeline_ids
    )
    ordered_to_process = [
        match_id for match_id in api_match_ids if match_id in matches_to_process
    ]
    for match_id in needs_reanalysis_ids:
        if match_id not in ordered_to_process:
            ordered_to_process.append(match_id)
    return ordered_to_process


async def fetch_analysis_timeline(
    riot_api_client: Any,
    puuid: str,
    match_id: str,
    rate_limiter: Optional[DBRateLimiter],
) -> tuple[Optional[Dict[str, Any]], bool]:
    """Fetch a timeline for analysis. The bool is True when the limiter blocked."""
    try:
        timeline_requested = False
        if rate_limiter:
            can_proceed = await rate_limiter.acquire()
            if not can_proceed:
                logger.warning(
                    "Rate limit reached during analysis timeline fetch",
                    puuid=puuid,
                    match_id=match_id,
                )
                return None, True
        timeline_payload = await riot_api_client.get_match_timeline(match_id)
        timeline_requested = True
        if rate_limiter and timeline_requested:
            await rate_limiter.record_request()
        return timeline_payload, False
    except Exception as timeline_error:
        logger.warning(
            "Failed to fetch timeline during analysis, continuing without timeline",
            match_id=match_id,
            error=str(timeline_error),
        )
        return None, False


async def process_analysis_match(
    riot_api_client: Any,
    puuid: str,
    match_id: str,
    rate_limiter: Optional[DBRateLimiter],
    is_current_game_version: Callable[[str], bool],
    reprocess_match: ReprocessMatch,
) -> AnalysisMatchResult:
    """Fetch, version-filter, and upsert one analysis match."""
    try:
        if rate_limiter:
            can_proceed = await rate_limiter.acquire()
            if not can_proceed:
                logger.warning(
                    "Rate limit reached during analysis match fetch",
                    puuid=puuid,
                    match_id=match_id,
                )
                return "rate_limited"
        match_dto = await riot_api_client.get_match(match_id)
        if rate_limiter:
            await rate_limiter.record_request()
        if not match_dto:
            return "continue"
        game_version = match_dto.info.game_version
        if not is_current_game_version(game_version):
            logger.debug(
                "Skipping historical match",
                match_id=match_id,
                game_version=game_version,
            )
            return "skipped_season"
        timeline_payload, rate_limited = await fetch_analysis_timeline(
            riot_api_client,
            puuid,
            match_id,
            rate_limiter,
        )
        if rate_limited:
            return "rate_limited"
        await reprocess_match(match_dto, timeline_payload=timeline_payload)
        return "processed"
    except Exception as error:
        logger.error("Failed to process match", match_id=match_id, error=str(error))
        return "continue"


def apply_analysis_match_result(
    result: AnalysisMatchResult,
    processed: int,
    skipped_season: int,
) -> tuple[int, int, bool]:
    """Update analysis counters. The bool is True when processing must stop."""
    if result == "rate_limited":
        return processed, skipped_season, True
    if result == "skipped_season":
        return processed, skipped_season + 1, False
    if result == "processed":
        return processed + 1, skipped_season, False
    return processed, skipped_season, False


async def run_analysis_processing_loop(
    ordered_to_process: List[str],
    puuid: str,
    should_cancel: Optional[Any],
    progress_callback: Optional[Any],
    riot_api_client: Any,
    rate_limiter: Optional[DBRateLimiter],
    is_current_game_version: Callable[[str], bool],
    reprocess_match: ReprocessMatch,
) -> tuple[int, int]:
    """Walk the analysis queue with cancel, progress, and rate-limit checks."""
    processed = 0
    skipped_season = 0
    total = len(ordered_to_process)
    for index, match_id in enumerate(ordered_to_process):
        if should_cancel and should_cancel():
            logger.info(
                "Analysis cancelled by user request",
                puuid=puuid,
                processed=processed,
            )
            break
        if progress_callback:
            await progress_callback(index, total)
        await asyncio.sleep(1.2)
        processed, skipped_season, should_stop = apply_analysis_match_result(
            await process_analysis_match(
                riot_api_client,
                puuid,
                match_id,
                rate_limiter,
                is_current_game_version,
                reprocess_match,
            ),
            processed,
            skipped_season,
        )
        if should_stop:
            break
    if progress_callback:
        await progress_callback(total, total)
    return processed, skipped_season


async def acquire_rate_limiter_or_raise(
    rate_limiter: Optional[DBRateLimiter],
) -> None:
    """Raise the same RateLimitError the queue-sync path used for a blocked slot."""
    if rate_limiter:
        can_proceed = await rate_limiter.acquire()
        if not can_proceed:
            raise RateLimitError(
                "Local rate limiter capacity unavailable",
                status_code=429,
            )


async def record_rate_limiter_request(
    rate_limiter: Optional[DBRateLimiter],
    requested: bool,
) -> None:
    if rate_limiter and requested:
        await rate_limiter.record_request()


async def fetch_queue_match_list(
    riot_client: Any,
    puuid: str,
    region: Any,
    queue_id: int,
    start: int,
    count: int,
    rate_limiter: Optional[DBRateLimiter],
) -> Any:
    """Fetch one page of match IDs for a supported queue."""
    try:
        await acquire_rate_limiter_or_raise(rate_limiter)
        match_list_dto = await riot_client.get_match_list_by_puuid(
            puuid=puuid,
            region=region,
            start=start,
            count=count,
            queue=queue_id,
        )
        if rate_limiter:
            await rate_limiter.record_request()
        return match_list_dto
    except AuthenticationError, ForbiddenError, RateLimitError:
        raise
    except Exception as error:
        logger.error(
            "Failed to fetch match IDs",
            puuid=puuid,
            queue_id=queue_id,
            error=str(error),
        )
        raise


async def load_queue_sync_completion_ids(
    session: AsyncSession,
    ids_list: List[str],
) -> tuple[set[str], set[str]]:
    """Load fully-analyzed IDs and IDs whose timeline rows are already complete."""
    analyzed_result = await session.execute(
        select(Match.match_id).where(
            Match.match_id.in_(ids_list), Match.fully_analyzed.is_(True)
        )
    )
    analyzed_ids = set(analyzed_result.scalars().all())
    timeline_counts_result = await session.execute(
        select(MatchTimeline.match_id, func.count(MatchTimeline.puuid))
        .where(MatchTimeline.match_id.in_(ids_list))
        .group_by(MatchTimeline.match_id)
    )
    timeline_complete_ids = {
        match_id
        for match_id, participant_rows in timeline_counts_result.all()
        if participant_rows >= 10
    }
    return analyzed_ids, timeline_complete_ids


def classify_queue_match_ids(
    ids_list: List[str],
    analyzed_ids: set[str],
    timeline_complete_ids: set[str],
) -> tuple[List[str], set[str]]:
    """Split a page into matches that still need work and timeline-only backfills."""
    ids_to_process = [
        match_id
        for match_id in ids_list
        if match_id not in analyzed_ids or match_id not in timeline_complete_ids
    ]
    timeline_only_ids = {
        match_id
        for match_id in ids_list
        if match_id in analyzed_ids and match_id not in timeline_complete_ids
    }
    return ids_to_process, timeline_only_ids


def build_synthetic_match_dto(
    match_id: str,
    participants: List[MatchParticipant],
    game_version: str = "",
) -> SimpleNamespace:
    """Build the minimal DTO shape timeline replacement needs for a stored match."""
    return SimpleNamespace(
        metadata=SimpleNamespace(match_id=match_id),
        info=SimpleNamespace(
            game_version=game_version,
            participants=[
                SimpleNamespace(
                    participant_id=participant.participant_id,
                    team_id=participant.team_id,
                    puuid=participant.puuid,
                )
                for participant in participants
            ],
        ),
    )


async def fetch_sync_timeline(
    riot_client: Any,
    puuid: str,
    region: Any,
    queue_id: int,
    match_id: str,
    rate_limiter: Optional[DBRateLimiter],
    on_failure: OnFailure,
    *,
    operation: str,
    log_message: str,
    skip_match_on_error: bool,
) -> tuple[Optional[Dict[str, Any]], bool]:
    """Fetch a timeline during queue sync. The bool is True when the match should be skipped."""
    timeline_payload: Optional[Dict[str, Any]] = None
    timeline_request_attempted = False
    try:
        await acquire_rate_limiter_or_raise(rate_limiter)
        timeline_request_attempted = True
        timeline_payload = await riot_client.get_match_timeline(
            match_id,
            region=region,
        )
    except AuthenticationError, ForbiddenError, RateLimitError:
        raise
    except Exception as timeline_error:
        if must_abort_writer_sync(timeline_error):
            raise
        logger.warning(
            log_message,
            puuid=puuid,
            queue_id=queue_id,
            match_id=match_id,
            error=str(timeline_error),
        )
        if on_failure:
            on_failure(
                operation,
                timeline_error,
                {"queue_id": queue_id, "match_id": match_id},
            )
        return None, skip_match_on_error
    finally:
        await record_rate_limiter_request(rate_limiter, timeline_request_attempted)
    return timeline_payload, False


async def backfill_timeline_only_match(
    session: AsyncSession,
    riot_client: Any,
    puuid: str,
    region: Any,
    queue_id: int,
    match_id: str,
    rate_limiter: Optional[DBRateLimiter],
    on_failure: OnFailure,
    ensure_maintenance: EnsureMaintenance,
) -> int:
    """Store missing timeline aggregates for an already-analyzed match."""
    timeline_payload, should_skip = await fetch_sync_timeline(
        riot_client,
        puuid,
        region,
        queue_id,
        match_id,
        rate_limiter,
        on_failure,
        operation="timeline-only backfill",
        log_message="Timeline-only fetch failed",
        skip_match_on_error=True,
    )
    if should_skip or not timeline_payload:
        return 0
    participants_result = await session.execute(
        select(MatchParticipant).where(MatchParticipant.match_id == match_id)
    )
    participants = list(participants_result.scalars().all())
    if len(participants) < 10:
        logger.warning(
            "Skipping timeline-only backfill due to missing participants",
            puuid=puuid,
            queue_id=queue_id,
            match_id=match_id,
            participants_found=len(participants),
        )
        return 0
    version_result = await session.execute(
        select(Match.game_version).where(Match.match_id == match_id)
    )
    game_version = version_result.scalar_one_or_none() or ""
    await ensure_maintenance(session)
    timeline_rows = await replace_match_timeline_rows(
        session,
        build_synthetic_match_dto(match_id, participants, game_version),
        timeline_payload,
    )
    if timeline_rows > 0:
        await session.commit()
        return 1
    return 0


async def sync_full_queue_match(
    riot_client: Any,
    puuid: str,
    region: Any,
    queue_id: int,
    match_id: str,
    rate_limiter: Optional[DBRateLimiter],
    on_failure: OnFailure,
    is_current_game_version: Callable[[str], bool],
    reprocess_match: ReprocessMatch,
) -> tuple[int, bool]:
    """Fetch and store one current-season match. The bool is True when the queue is done."""
    await acquire_rate_limiter_or_raise(rate_limiter)
    match_dto = await riot_client.get_match(match_id, region=region)
    if rate_limiter:
        await rate_limiter.record_request()
    if not match_dto:
        return 0, False
    if not is_current_game_version(match_dto.info.game_version):
        return 0, True
    timeline_payload, _should_skip = await fetch_sync_timeline(
        riot_client,
        puuid,
        region,
        queue_id,
        match_id,
        rate_limiter,
        on_failure,
        operation="match timeline fetch",
        log_message="Timeline fetch failed, storing match without timeline",
        skip_match_on_error=False,
    )
    await reprocess_match(match_dto, timeline_payload=timeline_payload)
    return 1, False


async def process_queue_sync_match(
    session: AsyncSession,
    riot_client: Any,
    puuid: str,
    region: Any,
    queue_id: int,
    match_id: str,
    timeline_only_ids: set[str],
    rate_limiter: Optional[DBRateLimiter],
    on_failure: OnFailure,
    ensure_maintenance: EnsureMaintenance,
    is_current_game_version: Callable[[str], bool],
    reprocess_match: ReprocessMatch,
) -> tuple[int, bool]:
    """Process one queue-sync match, including recoverable per-match failures."""
    try:
        if match_id in timeline_only_ids:
            stored = await backfill_timeline_only_match(
                session,
                riot_client,
                puuid,
                region,
                queue_id,
                match_id,
                rate_limiter,
                on_failure,
                ensure_maintenance,
            )
            return stored, False
        return await sync_full_queue_match(
            riot_client,
            puuid,
            region,
            queue_id,
            match_id,
            rate_limiter,
            on_failure,
            is_current_game_version,
            reprocess_match,
        )
    except AuthenticationError, ForbiddenError, RateLimitError:
        raise
    except Exception as error:
        if must_abort_writer_sync(error):
            raise
        logger.warning(
            "Error syncing match",
            puuid=puuid,
            queue_id=queue_id,
            match_id=match_id,
            error=str(error),
        )
        if on_failure:
            on_failure(
                "match synchronization",
                error,
                {"queue_id": queue_id, "match_id": match_id},
            )
        return 0, False


async def process_queue_sync_batch(
    session: AsyncSession,
    riot_client: Any,
    puuid: str,
    region: Any,
    queue_id: int,
    ids_to_process: List[str],
    timeline_only_ids: set[str],
    rate_limiter: Optional[DBRateLimiter],
    on_failure: OnFailure,
    ensure_maintenance: EnsureMaintenance,
    is_current_game_version: Callable[[str], bool],
    reprocess_match: ReprocessMatch,
    keep_fetching: bool,
) -> tuple[int, bool]:
    """Process one page of queue-sync match IDs."""
    stored = 0
    for match_id in ids_to_process:
        delta, stop_queue = await process_queue_sync_match(
            session,
            riot_client,
            puuid,
            region,
            queue_id,
            match_id,
            timeline_only_ids,
            rate_limiter,
            on_failure,
            ensure_maintenance,
            is_current_game_version,
            reprocess_match,
        )
        stored += delta
        if stop_queue:
            return stored, False
    return stored, keep_fetching


async def sync_single_queue_for_player(
    session: AsyncSession,
    riot_client: Any,
    puuid: str,
    region: Any,
    queue_id: int,
    rate_limiter: Optional[DBRateLimiter],
    on_failure: OnFailure,
    ensure_maintenance: EnsureMaintenance,
    is_current_game_version: Callable[[str], bool],
    reprocess_match: ReprocessMatch,
) -> int:
    """Sync one queue for a single player."""
    start = 0
    count = 100
    queue_stored = 0
    keep_fetching = True
    logger.info("Starting queue sync", puuid=puuid, queue_id=queue_id)
    while keep_fetching:
        match_list_dto = await fetch_queue_match_list(
            riot_client,
            puuid,
            region,
            queue_id,
            start,
            count,
            rate_limiter,
        )
        if not match_list_dto or not match_list_dto.match_ids:
            break
        ids_list = match_list_dto.match_ids
        analyzed_ids, timeline_complete_ids = await load_queue_sync_completion_ids(
            session,
            ids_list,
        )
        ids_to_process, timeline_only_ids = classify_queue_match_ids(
            ids_list,
            analyzed_ids,
            timeline_complete_ids,
        )
        stored, keep_fetching = await process_queue_sync_batch(
            session,
            riot_client,
            puuid,
            region,
            queue_id,
            ids_to_process,
            timeline_only_ids,
            rate_limiter,
            on_failure,
            ensure_maintenance,
            is_current_game_version,
            reprocess_match,
            keep_fetching,
        )
        queue_stored += stored
        if not keep_fetching or len(ids_list) < count:
            break
        start += count
    logger.info(
        "Completed queue sync",
        puuid=puuid,
        queue_id=queue_id,
        stored=queue_stored,
    )
    return queue_stored
