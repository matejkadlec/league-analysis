"""Tag evaluators and summary statistics for playstyle analysis."""

from collections.abc import Callable

from app.core.riot_api.constants import TeamId
from app.features.matches.lane import opposing_lane_participant
from app.features.matches.participants import MatchParticipant
from app.features.playstyle_analysis.aggregates import calculate_aggregate_value
from app.features.playstyle_analysis.config import TagConfig
from app.features.playstyle_analysis.models import SummaryStats, TagResult
from app.features.playstyle_analysis.tag_checks import MatchesById, lookup_match

TagEvaluator = Callable[
    [list[MatchParticipant], MatchesById, int, str, TagConfig],
    TagResult | None,
]


def format_value(value: float) -> str:
    """Format value for display with smart rounding and thousands separators."""
    if value >= 1000:
        return f"{int(value):,}"

    if isinstance(value, int):
        return str(value)

    formatted = f"{value:.1f}"
    if formatted.endswith(".0"):
        return formatted[:-2]
    return formatted


def evaluate_tag(
    participants: list[MatchParticipant],
    matches: MatchesById,
    game_count: int,
    tag_code: str,
    config: TagConfig,
) -> TagResult | None:
    """Evaluate a single tag configuration."""
    tag_type = config.get("type")
    type_evaluator = (
        _TYPE_EVALUATORS.get(tag_type) if isinstance(tag_type, str) else None
    )
    if type_evaluator is not None:
        return type_evaluator(participants, matches, game_count, tag_code, config)

    code_evaluator = _CODE_EVALUATORS.get(tag_code)
    if code_evaluator is not None:
        return code_evaluator(participants, matches, game_count, tag_code, config)

    return evaluate_generic_threshold(
        participants, matches, game_count, tag_code, config
    )


def evaluate_generic_threshold(
    participants: list[MatchParticipant],
    matches: MatchesById,
    game_count: int,
    tag_code: str,
    config: TagConfig,
) -> TagResult | None:
    """Evaluate threshold based on actual average across ALL games."""
    aggregate_value = calculate_aggregate_value(
        participants, matches, tag_code, config, game_count
    )
    return _compare_aggregate_to_thresholds(config, aggregate_value)


def evaluate_occurrence_percentage(
    participants: list[MatchParticipant],
    matches: MatchesById,
    game_count: int,
    tag_code: str,
    config: TagConfig,
) -> TagResult | None:
    """Evaluate tags based on occurrence percentage (e.g. first-blood rate)."""
    target_percentage = config.get("percentage_matches", 0.0)
    max_percentage = config.get("max_percentage_matches")
    aggregate_value = calculate_aggregate_value(
        participants, matches, tag_code, config, game_count
    )

    if max_percentage is not None:
        if aggregate_value < max_percentage:
            return _met_criteria_result(config, aggregate_value)
        return None

    if aggregate_value >= target_percentage:
        return _met_criteria_result(config, aggregate_value)
    return None


def evaluate_occurrence_count(
    participants: list[MatchParticipant],
    matches: MatchesById,
    game_count: int,
    tag_code: str,
    config: TagConfig,
) -> TagResult | None:
    """Evaluate tags based on total occurrence count (e.g. pentakills, steals)."""
    aggregate_value = calculate_aggregate_value(
        participants, matches, tag_code, config, game_count
    )
    if aggregate_value >= 1:
        return _met_criteria_result(config, aggregate_value)
    return None


def evaluate_gold_diff_check(
    participants: list[MatchParticipant],
    matches: MatchesById,
    game_count: int,
    tag_code: str,
    config: TagConfig,
) -> TagResult | None:
    """Evaluate gold diff vs opponent (lead or deficit)."""
    check_deficit = config.get("check_deficit", False)

    if check_deficit:
        min_threshold = config.get("min_lane_gold_deficit", 1000)
    else:
        min_threshold = config.get("min_lane_gold_lead", 1000)

    total_gold_diff, games_with_opponent = _sum_lane_gold_diffs(participants, matches)
    if games_with_opponent == 0:
        return None

    avg_gold_diff = total_gold_diff / games_with_opponent
    if check_deficit:
        if avg_gold_diff <= -min_threshold:
            return _met_criteria_result(config, abs(avg_gold_diff))
    else:
        if avg_gold_diff >= min_threshold:
            return _met_criteria_result(config, avg_gold_diff)
    return None


def evaluate_damage_type(
    participants: list[MatchParticipant],
    matches: MatchesById,
    game_count: int,
    tag_code: str,
    config: TagConfig,
) -> TagResult | None:
    target_percentage = config.get("percentage_matches", 50.0)
    target_type = config.get("target_damage_type")
    matching_games, total_phys, total_magic, total_damage = _accumulate_damage(
        participants, target_type
    )
    pct = (matching_games / game_count) * 100.0 if game_count > 0 else 0

    if pct >= target_percentage:
        damage_pct = _typed_damage_percentage(
            target_type, total_phys, total_magic, total_damage
        )
        return _met_criteria_result(config, damage_pct)
    return None


def evaluate_side_preference(
    participants: list[MatchParticipant],
    matches: MatchesById,
    game_count: int,
    tag_code: str,
    config: TagConfig,
) -> TagResult | None:
    target_team = config.get("target_team")
    blue_stats, red_stats = _side_win_stats(participants)
    if blue_stats["games"] == 0 or red_stats["games"] == 0:
        return None

    blue_wr = (blue_stats["wins"] / blue_stats["games"]) * 100.0
    red_wr = (red_stats["wins"] / red_stats["games"]) * 100.0
    result_wr = _favored_side_wr(target_team, blue_wr, red_wr)
    if result_wr is None:
        return None
    return _met_criteria_result(config, result_wr)


def evaluate_surrender(
    participants: list[MatchParticipant],
    matches: MatchesById,
    game_count: int,
    tag_code: str,
    config: TagConfig,
) -> TagResult | None:
    check_type = config.get("check")
    surrender_count, total_games = _count_surrenders(participants, matches)
    if total_games == 0:
        return None

    surrender_rate = (surrender_count / total_games) * 100.0
    if check_type == "never" and surrender_rate <= 10.0:
        return _met_criteria_result(config, surrender_rate)

    if check_type == "often" and surrender_rate >= 30.0:
        return _met_criteria_result(config, surrender_rate)

    return None


def evaluate_kill_greed(
    participants: list[MatchParticipant],
    matches: MatchesById,
    game_count: int,
    tag_code: str,
    config: TagConfig,
) -> TagResult | None:
    """Evaluate takes_all_kills: Non-solo kills vs assists ratio (per-match)."""
    target_percentage = config.get("percentage_matches", 40.0)
    min_ratio = config.get("min_kill_assist_ratio", 4.0)
    matching_games, total_ratio, valid_games = _kill_greed_totals(
        participants, matches, min_ratio
    )
    pct_matches = (matching_games / game_count) * 100.0 if game_count > 0 else 0
    if pct_matches >= target_percentage:
        avg_ratio = total_ratio / valid_games if valid_games > 0 else 0
        return _met_criteria_result(config, avg_ratio)
    return None


def evaluate_solo_kill_ratio(
    participants: list[MatchParticipant],
    matches: MatchesById,
    game_count: int,
    tag_code: str,
    config: TagConfig,
) -> TagResult | None:
    """Evaluate duelist: Solo kills vs assists ratio (per-match)."""
    target_percentage = config.get("percentage_matches", 30.0)
    min_ratio = config.get("min_solo_kill_assist_ratio", 4.0)
    matching_games, total_ratio, valid_games = _solo_kill_ratio_totals(
        participants, min_ratio
    )
    pct_matches = (matching_games / game_count) * 100.0 if game_count > 0 else 0
    if pct_matches >= target_percentage:
        avg_ratio = total_ratio / valid_games if valid_games > 0 else 0
        return _met_criteria_result(config, avg_ratio)
    return None


def evaluate_objective_participation(
    participants: list[MatchParticipant],
    matches: MatchesById,
    game_count: int,
    tag_code: str,
    config: TagConfig,
) -> TagResult | None:
    """Evaluate ignores_objectives: Player's obj damage < 10% of team (per-match)."""
    target_percentage = config.get("percentage_matches", 40.0)
    max_pct = config.get("max_objective_damage_pct", 10)
    matching_games, total_pct, valid_games = _objective_participation_totals(
        participants, matches, max_pct
    )
    pct_matches = (matching_games / game_count) * 100.0 if game_count > 0 else 0
    if pct_matches >= target_percentage:
        avg_pct = total_pct / valid_games if valid_games > 0 else 0
        return _met_criteria_result(config, avg_pct)
    return None


def evaluate_nolifer(
    participants: list[MatchParticipant],
    matches: MatchesById,
    game_count: int,
    tag_code: str,
    config: TagConfig,
) -> TagResult | None:
    if not participants:
        return None
    level = participants[0].summoner_level or 0
    if level >= config.get("min_summoner_level", 500):
        description = config["hover_template"].format(value=level)
        return {"threshold_met": True, "description": description, "value": level}
    return None


def evaluate_otp(
    participants: list[MatchParticipant],
    matches: MatchesById,
    game_count: int,
    tag_code: str,
    config: TagConfig,
) -> TagResult | None:
    return _evaluate_champion_play_rate(
        participants, game_count, config, default_min_play_rate=70.0
    )


def evaluate_main_champion(
    participants: list[MatchParticipant],
    matches: MatchesById,
    game_count: int,
    tag_code: str,
    config: TagConfig,
) -> TagResult | None:
    return _evaluate_champion_play_rate(
        participants, game_count, config, default_min_play_rate=50.0
    )


def evaluate_main_role(
    participants: list[MatchParticipant],
    matches: MatchesById,
    game_count: int,
    tag_code: str,
    config: TagConfig,
) -> TagResult | None:
    roles: dict[str, int] = {}
    for p in participants:
        r = p.team_position
        if r and r != "UNKNOWN":
            roles[r] = roles.get(r, 0) + 1

    if not roles:
        return None
    top_role, count = max(roles.items(), key=lambda x: x[1])
    rate = (count / game_count) * 100.0

    if rate >= config.get("min_play_rate", 50.0):
        formatted_role = top_role.title()
        description = config["hover_template"].format(
            value=format_value(rate), role=formatted_role
        )
        display_name = config["display_name"].format(role=formatted_role)
        return {
            "threshold_met": True,
            "description": description,
            "value": rate,
            "display_name": display_name,
        }
    return None


def generate_summary_stats(
    participants: list[MatchParticipant], game_count: int
) -> SummaryStats:
    """Generate summary statistics for the player.

    Never called with no participants: `analyze_playstyle` stores a null
    summary before it builds an engine, so `game_count` is always non-zero.
    """
    wins = sum(1 for p in participants if p.win)
    losses = game_count - wins
    avg_kills, avg_deaths, avg_assists, avg_kda = _average_combat_stats(
        participants, game_count
    )
    recent_win_rate = _recent_win_rate(participants)
    roles, role_wins, champs = _count_roles_and_champs(participants)
    most_played_role, main_role_win_rate = _main_role_stats(
        roles, role_wins, game_count
    )
    most_played_champion = _most_played_champion(participants, champs, most_played_role)
    most_played_champion_win_rate = _champion_win_rate(
        participants, most_played_champion
    )

    return {
        "total_games": game_count,
        "total_wins": wins,
        "total_losses": losses,
        "win_rate": float(wins) / float(game_count),
        "recent_win_rate": recent_win_rate,
        "avg_kills": avg_kills,
        "avg_deaths": avg_deaths,
        "avg_assists": avg_assists,
        "main_role": most_played_role,
        "main_role_win_rate": main_role_win_rate,
        "avg_kda": float(avg_kda),
        "most_played_champion": most_played_champion,
        "most_played_champion_win_rate": most_played_champion_win_rate,
    }


def _met_criteria_result(config: TagConfig, value: float) -> TagResult:
    """A met tag carrying its value formatted into the configured hover text."""
    formatted_value = format_value(value)
    description = config["hover_template"].format(value=formatted_value)
    return {"threshold_met": True, "description": description, "value": value}


def _compare_aggregate_to_thresholds(
    config: TagConfig, aggregate_value: float
) -> TagResult | None:
    # A generic tag carries exactly one `min_`/`max_` threshold key, so first
    # match is the only match; `min_play_rate`/`max_percentage_matches` are
    # selection keys, not thresholds.
    for key, threshold in config.items():
        if not isinstance(threshold, int | float):
            continue
        if key.startswith("min_") and key != "min_play_rate":
            if aggregate_value >= threshold:
                return _met_criteria_result(config, aggregate_value)
            return None
        elif key.startswith("max_") and key != "max_percentage_matches":
            if aggregate_value <= threshold:
                return _met_criteria_result(config, aggregate_value)
            return None
    return None


def _sum_lane_gold_diffs(
    participants: list[MatchParticipant], matches: MatchesById
) -> tuple[float, int]:
    total_gold_diff = 0
    games_with_opponent = 0
    for p in participants:
        match = lookup_match(matches, p.match_id)
        if not match:
            continue
        opponent = opposing_lane_participant(
            p, match.participants or [], skip_unknown=True
        )
        if opponent:
            games_with_opponent += 1
            diff = (p.gold_earned or 0) - (opponent.gold_earned or 0)
            total_gold_diff += diff
    return total_gold_diff, games_with_opponent


def _accumulate_damage(
    participants: list[MatchParticipant], target_type: str | None
) -> tuple[int, int, int, int]:
    matching_games = 0
    total_phys_damage = 0
    total_magic_damage = 0
    total_damage = 0
    for p in participants:
        phys = p.physical_damage_dealt_to_champions or 0
        magic = p.magic_damage_dealt_to_champions or 0
        total_phys_damage += phys
        total_magic_damage += magic
        total_damage += phys + magic
        if (target_type == "physical" and phys > magic) or (
            target_type == "magic" and magic > phys
        ):
            matching_games += 1
    return matching_games, total_phys_damage, total_magic_damage, total_damage


def _typed_damage_percentage(
    target_type: str | None,
    total_phys: float,
    total_magic: float,
    total_damage: float,
) -> float:
    if total_damage > 0:
        if target_type == "physical":
            return (total_phys / total_damage) * 100.0
        return (total_magic / total_damage) * 100.0
    return 0.0


def _side_win_stats(
    participants: list[MatchParticipant],
) -> tuple[dict[str, int], dict[str, int]]:
    blue_stats = {"wins": 0, "games": 0}
    red_stats = {"wins": 0, "games": 0}
    for p in participants:
        if p.team_id == TeamId.BLUE:
            blue_stats["games"] += 1
            if p.win:
                blue_stats["wins"] += 1
        elif p.team_id == TeamId.RED:
            red_stats["games"] += 1
            if p.win:
                red_stats["wins"] += 1
    return blue_stats, red_stats


def _favored_side_wr(
    target_team: TeamId | None, blue_wr: float, red_wr: float
) -> float | None:
    diff = 5.0
    is_blue_favored = (blue_wr - red_wr) >= diff
    is_red_favored = (red_wr - blue_wr) >= diff
    if target_team == TeamId.BLUE and is_blue_favored:
        return blue_wr
    if target_team == TeamId.RED and is_red_favored:
        return red_wr
    return None


def _count_surrenders(
    participants: list[MatchParticipant], matches: MatchesById
) -> tuple[int, int]:
    surrender_count = 0
    total_games = 0
    for p in participants:
        m = matches.get(p.match_id)
        if not m:
            continue
        total_games += 1
        if getattr(m, "surrender", False) and not getattr(m, "early_surrender", False):
            surrender_count += 1
    return surrender_count, total_games


def _kill_greed_totals(
    participants: list[MatchParticipant], matches: MatchesById, min_ratio: float
) -> tuple[int, float, int]:
    matching_games = 0
    total_ratio = 0
    valid_games = 0
    for p in participants:
        match = lookup_match(matches, p.match_id)
        if not match:
            continue
        result = _kill_greed_for_participant(p, min_ratio)
        if result is None:
            continue
        matching, ratio = result
        total_ratio += ratio
        valid_games += 1
        if matching:
            matching_games += 1
    return matching_games, total_ratio, valid_games


def _kill_greed_for_participant(
    p: MatchParticipant, min_ratio: float
) -> tuple[bool, float] | None:
    player_kills = p.kills or 0
    player_assists = p.assists or 0
    player_solo_kills = p.solo_kills or 0
    non_solo_kills = player_kills - player_solo_kills
    if player_assists == 0:
        if non_solo_kills >= 3:
            return True, float(non_solo_kills)
        return None
    ratio = non_solo_kills / player_assists
    return ratio >= min_ratio, ratio


def _solo_kill_ratio_totals(
    participants: list[MatchParticipant], min_ratio: float
) -> tuple[int, float, int]:
    matching_games = 0
    total_ratio = 0
    valid_games = 0
    for p in participants:
        result = _solo_kill_ratio_for_participant(p, min_ratio)
        if result is None:
            continue
        matching, ratio = result
        matching_games += 1 if matching else 0
        total_ratio += ratio
        valid_games += 1
    return matching_games, total_ratio, valid_games


def _solo_kill_ratio_for_participant(
    p: MatchParticipant, min_ratio: float
) -> tuple[bool, float] | None:
    player_solo_kills = p.solo_kills or 0
    player_assists = p.assists or 0
    if player_solo_kills == 0:
        return None
    if player_assists == 0:
        return True, float(player_solo_kills * 10)
    ratio = player_solo_kills / player_assists
    return ratio >= min_ratio, ratio


def _objective_participation_totals(
    participants: list[MatchParticipant], matches: MatchesById, max_pct: float
) -> tuple[int, float, int]:
    matching_games = 0
    total_pct = 0
    valid_games = 0
    for p in participants:
        result = _objective_share_for_participant(p, matches)
        if result is None:
            continue
        valid_games += 1
        total_pct += result
        if result < max_pct:
            matching_games += 1
    return matching_games, total_pct, valid_games


def _objective_share_for_participant(
    p: MatchParticipant, matches: MatchesById
) -> float | None:
    match = lookup_match(matches, p.match_id)
    if not match:
        return None
    team_participants = [x for x in match.participants if x.team_id == p.team_id]
    total_team_obj_dmg = sum(
        (x.damage_dealt_to_objectives or 0) for x in team_participants
    )
    if total_team_obj_dmg == 0:
        return None
    player_obj_dmg = p.damage_dealt_to_objectives or 0
    return (player_obj_dmg / total_team_obj_dmg) * 100.0


def _evaluate_champion_play_rate(
    participants: list[MatchParticipant],
    game_count: int,
    config: TagConfig,
    default_min_play_rate: float,
) -> TagResult | None:
    champs: dict[str, int] = {}
    for p in participants:
        champs[p.champion_name] = champs.get(p.champion_name, 0) + 1

    if not champs:
        return None
    top_champ, count = max(champs.items(), key=lambda x: x[1])
    rate = (count / game_count) * 100.0

    if rate >= config.get("min_play_rate", default_min_play_rate):
        description = config["hover_template"].format(
            value=format_value(rate), champion=top_champ
        )
        display_name = config["display_name"].format(champion=top_champ)
        return {
            "threshold_met": True,
            "description": description,
            "value": rate,
            "display_name": display_name,
        }
    return None


def _average_combat_stats(
    participants: list[MatchParticipant], game_count: int
) -> tuple[float, float, float, float]:
    total_kills = sum(p.kills for p in participants)
    total_deaths = sum(p.deaths for p in participants)
    total_assists = sum(p.assists for p in participants)
    avg_kda = (
        (total_kills + total_assists) / total_deaths
        if total_deaths > 0
        else (total_kills + total_assists)
    )
    return (
        total_kills / game_count,
        total_deaths / game_count,
        total_assists / game_count,
        avg_kda,
    )


def _recent_win_rate(participants: list[MatchParticipant]) -> float:
    recent_participants = participants[:10]
    recent_total = len(recent_participants)
    recent_win_rate = 0.0
    if recent_total > 0:
        recent_wins = sum(1 for p in recent_participants if p.win)
        recent_win_rate = recent_wins / recent_total
    return recent_win_rate


def _count_roles_and_champs(
    participants: list[MatchParticipant],
) -> tuple[dict[str, int], dict[str, int], dict[str, int]]:
    roles: dict[str, int] = {}
    role_wins: dict[str, int] = {}
    champs: dict[str, int] = {}
    for p in participants:
        role = p.team_position or "UNKNOWN"
        if role != "UNKNOWN":
            roles[role] = roles.get(role, 0) + 1
            if p.win:
                role_wins[role] = role_wins.get(role, 0) + 1
        champ = p.champion_name
        if champ:
            champs[champ] = champs.get(champ, 0) + 1
    return roles, role_wins, champs


def _main_role_stats(
    roles: dict[str, int], role_wins: dict[str, int], game_count: int
) -> tuple[str | None, float]:
    """The role the player is on in over half their games, if there is one."""
    if not roles:
        return None, 0.0
    most_played_role = max(roles.items(), key=lambda x: x[1])[0]
    role_play_count = roles[most_played_role]
    if role_play_count / game_count <= 0.5:
        return None, 0.0
    return most_played_role, role_wins.get(most_played_role, 0) / role_play_count


def _most_played_champion(
    participants: list[MatchParticipant],
    champs: dict[str, int],
    most_played_role: str | None,
) -> str | None:
    """The most played champion, narrowed to the main role when there is one."""
    if most_played_role is not None and most_played_role != "UNKNOWN":
        role_champs: dict[str, int] = {}
        for p in participants:
            if p.team_position == most_played_role and p.champion_name:
                role_champs[p.champion_name] = role_champs.get(p.champion_name, 0) + 1
        champs = role_champs
    if not champs:
        return None
    return max(champs.items(), key=lambda x: x[1])[0]


def _champion_win_rate(
    participants: list[MatchParticipant], most_played_champion: str | None
) -> float:
    most_played_champion_win_rate = 0.0
    if most_played_champion is not None:
        champ_games = [
            p for p in participants if p.champion_name == most_played_champion
        ]
        if champ_games:
            champ_wins = sum(1 for p in champ_games if p.win)
            most_played_champion_win_rate = champ_wins / len(champ_games)
    return most_played_champion_win_rate


_TYPE_EVALUATORS: dict[str, TagEvaluator] = {
    "damage_type": evaluate_damage_type,
    "side_preference": evaluate_side_preference,
    "surrender_check": evaluate_surrender,
    "gold_diff_check": evaluate_gold_diff_check,
    "kill_greed_check": evaluate_kill_greed,
    "solo_kill_ratio_check": evaluate_solo_kill_ratio,
    "objective_participation_check": evaluate_objective_participation,
    "occurrence_percentage": evaluate_occurrence_percentage,
    "occurrence_count": evaluate_occurrence_count,
}

_CODE_EVALUATORS: dict[str, TagEvaluator] = {
    "nolifer": evaluate_nolifer,
    "otp": evaluate_otp,
    "main_champion": evaluate_main_champion,
    "main_role": evaluate_main_role,
}
