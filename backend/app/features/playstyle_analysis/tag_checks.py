"""Per-match condition checks for playstyle tags."""

from typing import Any, Callable, Dict, List, Optional

from app.features.matches.models import Match
from app.features.matches.participants import MatchParticipant

MatchesById = Dict[Any, Match]
ConditionCheck = Callable[
    [MatchParticipant, Dict[str, Any], MatchesById],
    bool,
]

_GENERIC_MIN_EXCLUDED = [
    "min_kda",
    "min_first_blood_participation",
    "min_dead_time_ratio",
    "min_potions",
    "min_total_minions",
    "min_cs",
    "min_vision_score_per_minute",
    "min_team_damage_pct",
    "min_team_damage_taken_pct",
    "min_kill_participation",
]

_GENERIC_MAX_EXCLUDED = [
    "max_cs",
    "max_team_damage_taken_pct",
    "max_kill_participation",
]


def lookup_match(matches: MatchesById, match_id: Any) -> Optional[Match]:
    return matches.get(str(match_id)) or matches.get(match_id)


def team_attribute_share(
    p: MatchParticipant, match: Match, attr: str
) -> Optional[float]:
    team_participants = [x for x in match.participants if x.team_id == p.team_id]
    total = sum((getattr(x, attr) or 0) for x in team_participants)
    if total > 0:
        return (getattr(p, attr) or 0) / total * 100.0
    return None


def team_kill_participation(p: MatchParticipant, match: Match) -> Optional[float]:
    team_participants = [x for x in match.participants if x.team_id == p.team_id]
    total_kills = sum((x.kills or 0) for x in team_participants)
    if total_kills > 0:
        return ((p.kills or 0) + (p.assists or 0)) / total_kills * 100.0
    return None


def check_match_condition(
    p: MatchParticipant,
    tag_code: str,
    config: Dict[str, Any],
    matches: MatchesById,
) -> bool:
    """Check if a single match meets the criteria.

    Now supports generic attribute mapping for keys starting with 'min_'.
    """
    for check in _SPECIAL_CONDITION_CHECKS:
        if not check(p, config, matches):
            return False
    if not _generic_min_attribute_checks(p, config):
        return False
    if not _generic_max_attribute_checks(p, config):
        return False
    return True


def _check_min_kda(
    p: MatchParticipant, config: Dict[str, Any], matches: MatchesById
) -> bool:
    if "min_kda" in config:
        deaths = p.deaths if p.deaths > 0 else 1
        kda = (p.kills + p.assists) / deaths
        if kda < config["min_kda"]:
            return False
    return True


def _check_min_first_blood(
    p: MatchParticipant, config: Dict[str, Any], matches: MatchesById
) -> bool:
    if "min_first_blood_participation" in config:
        if not p.first_blood_kill:
            return False
    return True


def _check_max_first_blood(
    p: MatchParticipant, config: Dict[str, Any], matches: MatchesById
) -> bool:
    if "max_first_blood_participation" in config:
        if p.first_blood_kill:
            return False
    return True


def _check_min_dead_time_ratio(
    p: MatchParticipant, config: Dict[str, Any], matches: MatchesById
) -> bool:
    if "min_dead_time_ratio" in config:
        duration = p.time_played if (p.time_played and p.time_played > 0) else 1
        ratio = (p.time_spent_dead or 0) / duration * 100.0
        if ratio < config["min_dead_time_ratio"]:
            return False
    return True


def _check_min_potions(
    p: MatchParticipant, config: Dict[str, Any], matches: MatchesById
) -> bool:
    if "min_potions" in config:
        potions = (p.consumables_purchased or 0) - (p.vision_wards_bought or 0)
        if potions < config["min_potions"]:
            return False
    return True


def _check_min_total_minions(
    p: MatchParticipant, config: Dict[str, Any], matches: MatchesById
) -> bool:
    if "min_total_minions" in config:
        cs = (p.total_minions_killed or 0) + (p.neutral_minions_killed or 0)
        if cs < config["min_total_minions"]:
            return False
    return True


def _check_min_cs(
    p: MatchParticipant, config: Dict[str, Any], matches: MatchesById
) -> bool:
    if "min_cs" in config:
        duration_min = (p.time_played or 1) / 60.0
        cs = (p.total_minions_killed or 0) + (p.neutral_minions_killed or 0)
        cspm = cs / duration_min if duration_min > 0 else 0
        if cspm < config["min_cs"]:
            return False
    return True


def _check_max_cs(
    p: MatchParticipant, config: Dict[str, Any], matches: MatchesById
) -> bool:
    if "max_cs" in config:
        duration_min = (p.time_played or 1) / 60.0
        cs = (p.total_minions_killed or 0) + (p.neutral_minions_killed or 0)
        cspm = cs / duration_min if duration_min > 0 else 0
        if cspm > config["max_cs"]:
            return False
    return True


def _check_min_vision_score_per_minute(
    p: MatchParticipant, config: Dict[str, Any], matches: MatchesById
) -> bool:
    if "min_vision_score_per_minute" in config:
        duration_min = (p.time_played or 1) / 60.0
        vspm = (p.vision_score or 0) / duration_min if duration_min > 0 else 0
        if vspm < config["min_vision_score_per_minute"]:
            return False
    return True


def _check_min_team_damage_pct(
    p: MatchParticipant, config: Dict[str, Any], matches: MatchesById
) -> bool:
    if "min_team_damage_pct" in config:
        match = lookup_match(matches, p.match_id)
        if match:
            pct = team_attribute_share(p, match, "total_damage_dealt_to_champions")
            if pct is not None and pct < config["min_team_damage_pct"]:
                return False
    return True


def _check_min_team_damage_taken_pct(
    p: MatchParticipant, config: Dict[str, Any], matches: MatchesById
) -> bool:
    if "min_team_damage_taken_pct" in config:
        match = lookup_match(matches, p.match_id)
        if match:
            pct = team_attribute_share(p, match, "total_damage_taken")
            if pct is not None and pct < config["min_team_damage_taken_pct"]:
                return False
    return True


def _check_min_kill_participation(
    p: MatchParticipant, config: Dict[str, Any], matches: MatchesById
) -> bool:
    if "min_kill_participation" in config:
        match = lookup_match(matches, p.match_id)
        if match:
            kp = team_kill_participation(p, match)
            if kp is not None and kp < config["min_kill_participation"]:
                return False
    return True


def _check_max_team_damage_taken_pct(
    p: MatchParticipant, config: Dict[str, Any], matches: MatchesById
) -> bool:
    if "max_team_damage_taken_pct" in config:
        match = lookup_match(matches, p.match_id)
        if match:
            pct = team_attribute_share(p, match, "total_damage_taken")
            if pct is not None and pct > config["max_team_damage_taken_pct"]:
                return False
    return True


def _check_max_kill_participation(
    p: MatchParticipant, config: Dict[str, Any], matches: MatchesById
) -> bool:
    if "max_kill_participation" in config:
        match = lookup_match(matches, p.match_id)
        if match:
            kp = team_kill_participation(p, match)
            if kp is not None and kp > config["max_kill_participation"]:
                return False
    return True


def _generic_min_attribute_checks(p: MatchParticipant, config: Dict[str, Any]) -> bool:
    for key, value in config.items():
        if key.startswith("min_") and key not in _GENERIC_MIN_EXCLUDED:
            attr_name = key[4:]
            if hasattr(p, attr_name):
                attr_val = getattr(p, attr_name) or 0
                if attr_val < value:
                    return False
    return True


def _generic_max_attribute_checks(p: MatchParticipant, config: Dict[str, Any]) -> bool:
    for key, value in config.items():
        if key.startswith("max_") and key not in _GENERIC_MAX_EXCLUDED:
            attr_name = key[4:]
            if hasattr(p, attr_name):
                attr_val = getattr(p, attr_name) or 0
                if attr_val > value:
                    return False
    return True


_SPECIAL_CONDITION_CHECKS: List[ConditionCheck] = [
    _check_min_kda,
    _check_min_first_blood,
    _check_max_first_blood,
    _check_min_dead_time_ratio,
    _check_min_potions,
    _check_min_total_minions,
    _check_min_cs,
    _check_max_cs,
    _check_min_vision_score_per_minute,
    _check_min_team_damage_pct,
    _check_min_team_damage_taken_pct,
    _check_min_kill_participation,
    _check_max_team_damage_taken_pct,
    _check_max_kill_participation,
]
