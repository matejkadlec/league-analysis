"""Match-history row assembly: teams, opponents, and player cards."""

from __future__ import annotations

from typing import Any, cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

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


def group_participants_by_match(
    all_participants: list[MatchParticipant],
) -> dict[str, list[MatchParticipant]]:
    """Group participant rows by match ID."""
    participants_by_match: dict[str, list[MatchParticipant]] = {}
    for participant in all_participants:
        if participant.match_id not in participants_by_match:
            participants_by_match[participant.match_id] = []
        participants_by_match[participant.match_id].append(participant)
    return participants_by_match


def index_timelines_by_match_team(
    timeline_rows: list[MatchTimeline],
) -> dict[str, dict[int, MatchTimeline]]:
    """Index one timeline row per team for each match."""
    timelines_by_match_team: dict[str, dict[int, MatchTimeline]] = {}
    for timeline_row in timeline_rows:
        match_teams = timelines_by_match_team.setdefault(timeline_row.match_id, {})
        if timeline_row.team_id not in match_teams:
            match_teams[timeline_row.team_id] = timeline_row
    return timelines_by_match_team


def find_lane_opponent(
    puuid: str,
    player_participant: MatchParticipant | None,
    match_participants: list[MatchParticipant],
) -> EnemyLaneOpponent | None:
    """Return the opposing player in the same assigned lane, if any."""
    if not player_participant:
        return None
    opponent = opposing_lane_participant(player_participant, match_participants)
    if opponent is None:
        return None
    return _enemy_lane_opponent(opponent)


def _enemy_lane_opponent(participant: MatchParticipant) -> EnemyLaneOpponent:
    opponent_cs = participant.cs
    return EnemyLaneOpponent(
        champion_id=participant.champion_id,
        champion_name=participant.champion_name,
        champion_level=participant.champion_level,
        kills=participant.kills or 0,
        deaths=participant.deaths or 0,
        assists=participant.assists or 0,
        kda=float(participant.kda),
        total_cs=opponent_cs,
        vision_score=participant.vision_score or 0,
        total_damage_dealt_to_champions=participant.total_damage_dealt_to_champions
        or 0,
        summoner1_id=participant.summoner1_id,
        summoner2_id=participant.summoner2_id,
        # The column holds `dict[str, Any] | None` but the field is declared
        # `RunesData | None`, and the raw dict is what the `mode="before"`
        # validator `transform_runes` is there to convert. Pyright checks the
        # call against the declared field type, which no pre-validator input
        # ever matches, so this cast marks a validator boundary rather than
        # silencing a real mismatch.
        runes=cast(Any, participant.runes),
    )


def timeline_int_or_none(timeline: MatchTimeline | None, attr: str) -> int | None:
    if timeline is None:
        return None
    return getattr(timeline, attr)


def timeline_int_or_zero(timeline: MatchTimeline | None, attr: str) -> int:
    if timeline is None:
        return 0
    return getattr(timeline, attr)


def empty_team_stats(timeline: MatchTimeline | None) -> dict[str, Any]:
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
    blue_team: list[TeamChampion],
    red_team: list[TeamChampion],
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


def compose_team_stats(stats: dict[str, Any]) -> TeamStats:
    return TeamStats(
        kills=stats["kills"],
        deaths=stats["deaths"],
        assists=stats["assists"],
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
    match_participants: list[MatchParticipant],
    timeline_by_team: dict[int, MatchTimeline],
) -> tuple[TeamComposition, TeamStatsComposition]:
    """Build both team compositions and aggregated team statistics."""
    blue_team: list[TeamChampion] = []
    red_team: list[TeamChampion] = []
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


def build_player_match_participant(
    player_participant: MatchParticipant | None,
) -> PlayerMatchParticipant | None:
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
        kda=float(player_participant.kda),
        total_cs=player_participant.cs,
        vision_score=player_participant.vision_score,
        total_damage_dealt_to_champions=player_participant.total_damage_dealt_to_champions
        or 0,
        summoner1_id=player_participant.summoner1_id,
        summoner2_id=player_participant.summoner2_id,
        # Same validator boundary as in the opponent builder above.
        runes=cast(Any, player_participant.runes),
    )


def build_match_with_player_data(
    match: Match,
    player_data: PlayerMatchParticipant | None,
    lane_opponent: EnemyLaneOpponent | None,
    lp_change: int | None,
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
    db_matches: list[Match],
    player_participants_by_match: dict[str, MatchParticipant],
    participants_by_match: dict[str, list[MatchParticipant]],
    timelines_by_match_team: dict[str, dict[int, MatchTimeline]],
    puuid: str,
) -> list[MatchWithPlayerData]:
    """Assemble the per-match player-data payload for a history page."""
    match_responses: list[MatchWithPlayerData] = []
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
                player_participant.lp_change if player_participant else None,
                team_compositions,
                team_stats,
            )
        )
    return match_responses


async def load_match_player_data_context(
    session: AsyncSession,
    puuid: str,
    match_ids: list[str],
) -> tuple[
    dict[str, MatchParticipant],
    dict[str, list[MatchParticipant]],
    dict[str, dict[int, MatchTimeline]],
]:
    """Load participants and timeline aggregates for a history page."""
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
    return (
        player_participants_by_match,
        group_participants_by_match(list(all_participants_result.scalars().all())),
        index_timelines_by_match_team(list(timeline_result.scalars().all())),
    )
