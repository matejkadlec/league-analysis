"""Match-history row assembly: LP, teams, opponents, and player cards."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, cast

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.players.leagues import PlayerLeague

from .lane import opposing_lane_participant
from .match_stats import advanced_int, or_zero
from .models import Match
from .participants import MatchParticipant
from .schemas import (
    EnemyLaneOpponent,
    MatchWithPlayerData,
    PlayerMatchParticipant,
    TeamChampion,
    TeamComposition,
    TeamStats,
    TeamStatsComposition,
)
from .timeline import MatchTimeline

ROLE_ORDER: dict[str, int] = {
    "TOP": 0,
    "JUNGLE": 1,
    "MIDDLE": 2,
    "BOTTOM": 3,
    "UTILITY": 4,
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
