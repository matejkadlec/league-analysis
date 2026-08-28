"""Aggregate metric calculations for playstyle tags."""

from collections.abc import Callable
from typing import Final

from app.features.matches.match_stats import advanced_int
from app.features.matches.models import Match
from app.features.matches.participants import MatchParticipant
from app.features.playstyle_analysis.config import TagConfig
from app.features.playstyle_analysis.tag_checks import (
    MatchesById,
    lookup_match,
    team_attribute_share,
    team_kill_participation,
)

Aggregator = Callable[
    [list[MatchParticipant], MatchesById, TagConfig, int],
    float,
]
AggregatorPredicate = Callable[[str, TagConfig], bool]


def calculate_aggregate_value(
    participants: list[MatchParticipant],
    matches: MatchesById,
    tag_code: str,
    config: TagConfig,
    game_count: int,
) -> float:
    """Calculate the average value (or specific metric) for the tag to display."""
    resolved_game_count = game_count if game_count > 0 else 1
    for predicate, handler in _AGGREGATORS:
        if predicate(tag_code, config):
            return handler(participants, matches, config, resolved_game_count)
    return _generic_metric_average(participants, config, resolved_game_count)


def _has_first_blood_participation(tag_code: str, config: TagConfig) -> bool:
    return "min_first_blood_participation" in config


def _has_min_dead_time_ratio(tag_code: str, config: TagConfig) -> bool:
    return "min_dead_time_ratio" in config


def _has_cs_per_minute(tag_code: str, config: TagConfig) -> bool:
    return "min_cs" in config or "max_cs" in config


def _has_min_total_minions(tag_code: str, config: TagConfig) -> bool:
    return "min_total_minions" in config


def _has_min_kda(tag_code: str, config: TagConfig) -> bool:
    return "min_kda" in config


def _has_min_potions(tag_code: str, config: TagConfig) -> bool:
    return "min_potions" in config


def _has_min_largest_multi_kill(tag_code: str, config: TagConfig) -> bool:
    return "min_largest_multi_kill" in config


def _has_min_epic_monster_steals(tag_code: str, config: TagConfig) -> bool:
    return "min_epic_monster_steals" in config


def _has_min_team_damage_pct(tag_code: str, config: TagConfig) -> bool:
    return "min_team_damage_pct" in config


def _has_team_damage_taken_pct(tag_code: str, config: TagConfig) -> bool:
    return (
        "min_team_damage_taken_pct" in config or "max_team_damage_taken_pct" in config
    )


def _has_kill_participation(tag_code: str, config: TagConfig) -> bool:
    return "min_kill_participation" in config or "max_kill_participation" in config


def _first_blood_rate(
    participants: list[MatchParticipant],
    matches: MatchesById,
    config: TagConfig,
    game_count: int,
) -> float:
    fb_count = sum(1 for p in participants if p.first_blood_kill)
    return (fb_count / game_count) * 100.0


def _dead_time_ratio(
    participants: list[MatchParticipant],
    matches: MatchesById,
    config: TagConfig,
    game_count: int,
) -> float:
    total_dead = sum(p.time_spent_dead or 0 for p in participants)
    total_time = sum(p.time_played or 0 for p in participants)
    if total_time == 0:
        return 0.0
    return (total_dead / total_time) * 100.0


def _cs_per_minute(
    participants: list[MatchParticipant],
    matches: MatchesById,
    config: TagConfig,
    game_count: int,
) -> float:
    total_cs = 0
    total_time_min = 0
    for p in participants:
        cs = (p.total_minions_killed or 0) + (p.neutral_minions_killed or 0)
        duration_min = (p.time_played or 1) / 60.0
        total_cs += cs
        total_time_min += duration_min
    return total_cs / total_time_min if total_time_min > 0 else 0.0


def _total_minions_per_game(
    participants: list[MatchParticipant],
    matches: MatchesById,
    config: TagConfig,
    game_count: int,
) -> float:
    total_cs = sum(
        (p.total_minions_killed or 0) + (p.neutral_minions_killed or 0)
        for p in participants
    )
    return total_cs / game_count


def _overall_kda(
    participants: list[MatchParticipant],
    matches: MatchesById,
    config: TagConfig,
    game_count: int,
) -> float:
    t_k = sum(p.kills for p in participants)
    t_d = sum(p.deaths for p in participants)
    t_a = sum(p.assists for p in participants)
    denom = t_d if t_d > 0 else 1
    return (t_k + t_a) / denom


def _potions_per_game(
    participants: list[MatchParticipant],
    matches: MatchesById,
    config: TagConfig,
    game_count: int,
) -> float:
    total_val = sum(
        (p.consumables_purchased or 0) - (p.vision_wards_bought or 0)
        for p in participants
    )
    return total_val / game_count


def _pentakill_count(
    participants: list[MatchParticipant],
    matches: MatchesById,
    config: TagConfig,
    game_count: int,
) -> float:
    return sum(1 for p in participants if (p.largest_multi_kill or 0) >= 5)


def _epic_steal_count(
    participants: list[MatchParticipant],
    matches: MatchesById,
    config: TagConfig,
    game_count: int,
) -> float:
    return sum(p.epic_monster_steals or 0 for p in participants)


def _collect_match_shares(
    participants: list[MatchParticipant],
    matches: MatchesById,
    share_fn: Callable[[MatchParticipant, Match], float | None],
) -> list[float]:
    values: list[float] = []
    for p in participants:
        match = lookup_match(matches, p.match_id)
        if match:
            share = share_fn(p, match)
            if share is not None:
                values.append(share)
    return values


def _average_or_zero(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _average_team_damage_pct(
    participants: list[MatchParticipant],
    matches: MatchesById,
    config: TagConfig,
    game_count: int,
) -> float:

    def share(p: MatchParticipant, match: Match) -> float | None:
        return team_attribute_share(p, match, "total_damage_dealt_to_champions")

    return _average_or_zero(_collect_match_shares(participants, matches, share))


def _average_team_damage_taken_pct(
    participants: list[MatchParticipant],
    matches: MatchesById,
    config: TagConfig,
    game_count: int,
) -> float:

    def share(p: MatchParticipant, match: Match) -> float | None:
        return team_attribute_share(p, match, "total_damage_taken")

    return _average_or_zero(_collect_match_shares(participants, matches, share))


def _average_kill_participation(
    participants: list[MatchParticipant],
    matches: MatchesById,
    config: TagConfig,
    game_count: int,
) -> float:
    return _average_or_zero(
        _collect_match_shares(participants, matches, team_kill_participation)
    )


# Ten tags below read a metric out of the `advanced_stats` blob. Resolution is
# by name, so a metric with neither a column nor an entry here does not raise --
# it scores 0.0 for everyone, and `test_playstyle_tag_config.py` refuses it.
_CHALLENGE_KEYS: Final[dict[str, str]] = {
    "roam_kills": "killsOnOtherLanesEarlyJungleAsLaner",
    "enemy_jungle_monster_kills": "enemyJungleMonsterKills",
    "turret_plates_taken": "turretPlatesTaken",
    "ally_saves": "saveAllyFromDeath",
    "survived_single_digit_hp_count": "survivedSingleDigitHpCount",
    "skillshots_hit": "skillshotsHit",
    "skillshots_dodged": "skillshotsDodged",
    "enemy_immobilizations": "enemyChampionImmobilizations",
    "kills_near_enemy_turret": "killsNearEnemyTurret",
    "buffs_stolen": "buffsStolen",
}


def metric_is_readable(metric: str) -> bool:
    """Return whether a threshold key names something a participant can answer."""
    return hasattr(MatchParticipant, metric) or metric in _CHALLENGE_KEYS


def _read_metric(participant: MatchParticipant, metric: str) -> float:
    if hasattr(MatchParticipant, metric):
        return getattr(participant, metric) or 0
    return advanced_int(participant.advanced_stats, _CHALLENGE_KEYS[metric])


def threshold_metric(config: TagConfig) -> str | None:
    """The first `min_`/`max_` key in a tag config that names a real metric."""
    for key in config:
        if key.startswith(("min_", "max_")) and metric_is_readable(key[4:]):
            return key[4:]
    return None


def _generic_metric_average(
    participants: list[MatchParticipant],
    config: TagConfig,
    game_count: int,
) -> float:
    main_metric = threshold_metric(config)
    if main_metric is None:
        return 0.0
    total_val = sum(_read_metric(p, main_metric) for p in participants)
    return total_val / game_count


_AGGREGATORS: list[tuple[AggregatorPredicate, Aggregator]] = [
    (_has_first_blood_participation, _first_blood_rate),
    (_has_min_dead_time_ratio, _dead_time_ratio),
    (_has_cs_per_minute, _cs_per_minute),
    (_has_min_total_minions, _total_minions_per_game),
    (_has_min_kda, _overall_kda),
    (_has_min_potions, _potions_per_game),
    (_has_min_largest_multi_kill, _pentakill_count),
    (_has_min_epic_monster_steals, _epic_steal_count),
    (_has_min_team_damage_pct, _average_team_damage_pct),
    (_has_team_damage_taken_pct, _average_team_damage_taken_pct),
    (_has_kill_participation, _average_kill_participation),
]
