"""Every registered evaluator type, driven through `evaluate_tag` dispatch.

Fixture rows carry only the `MatchParticipant` columns an evaluator reads.
Each type is covered clearly met, at its boundary, just below, or missing data.
"""

from dataclasses import dataclass
from typing import Any, cast

import pytest

from app.core.riot_api.constants import TeamId
from app.features.matches.models import Match
from app.features.matches.participants import MatchParticipant
from app.features.playstyle_analysis.config import TAG_CONFIG
from app.features.playstyle_analysis.evaluators import evaluate_tag, format_value
from app.features.playstyle_analysis.tag_checks import MatchesById


@dataclass
class _Participant:
    """The `MatchParticipant` columns the evaluators read."""

    puuid: str = "player"
    match_id: str = "EUN1_1"
    team_id: int = TeamId.BLUE
    win: bool = False
    team_position: str | None = None
    champion_name: str = "Ahri"
    summoner_level: int | None = None
    kills: int = 0
    deaths: int = 0
    assists: int = 0
    solo_kills: int | None = 0
    first_blood_kill: bool | None = False
    largest_multi_kill: int | None = 0
    objectives_stolen: int | None = 0
    epic_monster_steals: int | None = 0
    turret_kills: int | None = 0
    wards_placed: int | None = 0
    wards_killed: int | None = 0
    vision_score: int | None = 0
    vision_wards_bought: int | None = 0
    consumables_purchased: int | None = 0
    total_minions_killed: int | None = 0
    neutral_minions_killed: int | None = 0
    time_played: int | None = 0
    time_spent_dead: int | None = 0
    gold_earned: int | None = 0
    gold_per_minute: float | None = 0
    total_self_healing: int | None = 0
    total_damage_dealt_to_champions: int | None = 0
    total_damage_taken: int | None = 0
    physical_damage_dealt_to_champions: int | None = 0
    magic_damage_dealt_to_champions: int | None = 0
    damage_dealt_to_objectives: int | None = 0
    advanced_stats: dict[str, Any] | None = None


@dataclass
class _Match:
    """The `Match` surface the evaluators read."""

    match_id: str
    participants: list[MatchParticipant]
    surrender: bool = False
    early_surrender: bool = False


def _p(**overrides: Any) -> MatchParticipant:
    """One game of the analyzed player, defaulting to a quiet scoreline."""
    return cast(MatchParticipant, _Participant(**overrides))


def _m(
    match_id: str,
    participants: list[MatchParticipant],
    *,
    surrender: bool = False,
    early_surrender: bool = False,
) -> Match:
    return cast(Match, _Match(match_id, participants, surrender, early_surrender))


def _blank_matches_for(rows: list[MatchParticipant]) -> MatchesById:
    """A present-but-empty match for every id the rows reference."""
    return {
        match_id: _m(match_id, []) for match_id in {str(row.match_id) for row in rows}
    }


def _evaluate(rows: list[MatchParticipant], matches: MatchesById, tag_code: str) -> Any:
    return evaluate_tag(rows, matches, len(rows), tag_code, TAG_CONFIG[tag_code])


def _assert_met(result: Any) -> dict[str, Any]:
    assert result is not None
    assert result["threshold_met"] is True
    return cast(dict[str, Any], result)


def test_a_clearly_met_min_threshold_carries_the_score_and_the_note() -> None:
    rows = [_p(kills=6), _p(kills=5), _p(kills=7)]

    result = _assert_met(_evaluate(rows, {}, "slayer"))

    assert result["value"] == pytest.approx(6.0)
    assert result["description"] == "Averages 6 kills per game."


def test_the_average_exactly_at_a_min_threshold_still_qualifies() -> None:
    rows = [_p(kills=5), _p(kills=5), _p(kills=5)]

    result = _assert_met(_evaluate(rows, {}, "slayer"))

    assert result["value"] == pytest.approx(5.0)
    assert result["description"] == "Averages 5 kills per game."


def test_an_average_just_below_the_min_threshold_is_no_verdict() -> None:
    rows = [_p(kills=5), _p(kills=5), _p(kills=4)]

    assert _evaluate(rows, {}, "slayer") is None


@pytest.mark.parametrize(
    ("tag_code", "metric"),
    [
        ("warden", "wards_placed"),
        ("visionary", "vision_score"),
        ("fogmaker", "wards_killed"),
        ("healer", "total_self_healing"),
    ],
)
def test_a_missing_metric_column_scores_zero_and_stays_silent(
    tag_code: str, metric: str
) -> None:
    rows = [_p(**{metric: None}), _p(**{metric: None})]

    assert _evaluate(rows, {}, tag_code) is None


def test_an_advanced_stats_threshold_reads_the_challenge_key() -> None:
    rows = [
        _p(advanced_stats={"skillshotsHit": 40}),
        _p(advanced_stats={"skillshotsHit": 40}),
    ]

    result = _assert_met(_evaluate(rows, {}, "sniper"))

    assert result["value"] == pytest.approx(40.0)
    assert result["description"] == "Averages 40 skillshots hit per game."
    assert _evaluate([_p(advanced_stats=None), _p()], {}, "sniper") is None


def test_a_max_threshold_is_judged_from_below() -> None:
    """40 minutes, 150 CS a game: 3.75 CS/min is bad at farming, 6.25 is not."""
    low = [
        _p(total_minions_killed=150, time_played=2400),
        _p(total_minions_killed=150, time_played=2400),
    ]
    high = [
        _p(total_minions_killed=250, time_played=2400),
        _p(total_minions_killed=250, time_played=2400),
    ]

    result = _assert_met(_evaluate(low, {}, "bad_at_farming"))

    assert result["value"] == pytest.approx(3.75)
    assert result["description"] == "Averages 3.8 CS per minute."
    assert _evaluate(high, {}, "bad_at_farming") is None


def test_the_cs_boundary_sits_exactly_at_the_max_threshold() -> None:
    rows = [
        _p(total_minions_killed=200, time_played=2400),
        _p(total_minions_killed=200, time_played=2400),
    ]

    result = _assert_met(_evaluate(rows, {}, "bad_at_farming"))

    assert result["value"] == pytest.approx(5.0)
    assert result["description"] == "Averages 5 CS per minute."


def test_kill_participation_is_the_players_share_of_their_own_team_kills() -> None:
    """2 kills + 3 assists of 7 team kills; the enemy side must not dilute."""
    player = _p(kills=2, assists=3)
    teammates = [_p(puuid="a", kills=3), _p(puuid="b", kills=2)]
    enemy = _p(puuid="foe", team_id=TeamId.RED, kills=20)
    match = _m("EUN1_1", [player, *teammates, enemy])

    result = _assert_met(_evaluate([player], {"EUN1_1": match}, "team_player"))

    assert result["value"] == pytest.approx((2 + 3) / 7 * 100)
    assert result["description"] == "Averages 71.4% of team kills participation."


def test_kill_participation_boundary_and_just_below() -> None:
    def _share(mate_kills: int) -> Any:
        player = _p(kills=2, assists=3)
        mate = _p(puuid="a", kills=mate_kills)
        match = _m("EUN1_1", [player, mate])
        return _evaluate([player], {"EUN1_1": match}, "team_player")

    boundary = _assert_met(_share(8))  # (2+3) of 10 team kills = exactly 50%.
    assert boundary["value"] == pytest.approx(50.0)
    assert _share(9) is None  # (2+3) of 11 = 45.5%.


def test_occurrence_count_counts_qualifying_games() -> None:
    rows = [
        _p(largest_multi_kill=5),
        _p(largest_multi_kill=2),
        _p(largest_multi_kill=1),
    ]

    result = _assert_met(_evaluate(rows, {}, "pentakiller"))

    assert result["value"] == pytest.approx(1.0)
    assert result["description"] == "Averages 1 pentakills per game."
    assert (
        _evaluate(
            [_p(largest_multi_kill=4), _p(largest_multi_kill=4)], {}, "pentakiller"
        )
        is None
    )
    assert (
        _evaluate(
            [_p(largest_multi_kill=None), _p(largest_multi_kill=None)],
            {},
            "pentakiller",
        )
        is None
    )


def test_occurrence_count_over_a_generic_metric_sums_it_per_game() -> None:
    """Pentakills count games; steals are summed and divided, so one is not enough."""
    rows = [_p(objectives_stolen=5), _p(), _p(), _p()]

    result = _assert_met(_evaluate(rows, {}, "thief"))

    assert result["value"] == pytest.approx(1.25)
    assert result["description"] == "Averages 1.2 objective steals."
    assert _evaluate([_p(objectives_stolen=3), _p(), _p(), _p()], {}, "thief") is None


def test_first_blood_rate_reports_the_percentage_of_games() -> None:
    rows = [_p(first_blood_kill=True), _p(first_blood_kill=True), _p(), _p()]

    result = _assert_met(_evaluate(rows, {}, "aggresive_laner"))

    assert result["value"] == pytest.approx(50.0)
    assert result["description"] == "Gets First Blood in 50% of games."


def test_first_blood_rate_boundaries() -> None:
    at_the_line = [_p(first_blood_kill=True)] + [_p() for _ in range(4)]
    just_below = [_p(first_blood_kill=True)] + [_p() for _ in range(5)]

    boundary = _assert_met(_evaluate(at_the_line, {}, "aggresive_laner"))
    assert boundary["value"] == pytest.approx(20.0)
    assert boundary["description"] == "Gets First Blood in 20% of games."
    assert _evaluate(just_below, {}, "aggresive_laner") is None


def test_a_max_percentage_tag_inverts_the_first_blood_comparison() -> None:
    quiet = [_p(first_blood_kill=True)] + [_p() for _ in range(9)]
    busy = [_p(first_blood_kill=True) for _ in range(3)] + [_p() for _ in range(7)]

    result = _assert_met(_evaluate(quiet, {}, "passive_laner"))
    assert result["value"] == pytest.approx(10.0)
    assert result["description"] == "Gets First Blood in 10% of games."
    assert _evaluate(busy, {}, "passive_laner") is None
    # A game with no first-blood datum counts as no first blood.
    missing = _assert_met(
        _evaluate([_p(first_blood_kill=None), _p()], {}, "passive_laner")
    )
    assert missing["value"] == pytest.approx(0.0)


def test_damage_type_majority_and_the_target_school_filter() -> None:
    rows = [
        _p(physical_damage_dealt_to_champions=900, magic_damage_dealt_to_champions=100),
        _p(physical_damage_dealt_to_champions=800, magic_damage_dealt_to_champions=200),
        _p(physical_damage_dealt_to_champions=700, magic_damage_dealt_to_champions=300),
        _p(physical_damage_dealt_to_champions=100, magic_damage_dealt_to_champions=900),
    ]

    result = _assert_met(_evaluate(rows, {}, "warrior"))

    assert result["value"] == pytest.approx(62.5)  # 2500 of 4000 total damage.
    assert result["description"] == "62.5% of all damage dealt is physical."
    assert _evaluate(rows, {}, "wizard") is None


def test_damage_type_just_below_the_majority_is_no_verdict() -> None:
    rows = [
        _p(physical_damage_dealt_to_champions=800, magic_damage_dealt_to_champions=200),
        _p(physical_damage_dealt_to_champions=700, magic_damage_dealt_to_champions=300),
        _p(physical_damage_dealt_to_champions=100, magic_damage_dealt_to_champions=900),
        _p(physical_damage_dealt_to_champions=100, magic_damage_dealt_to_champions=900),
    ]

    assert _evaluate(rows, {}, "warrior") is None


def test_side_preference_follows_the_target_team() -> None:
    rows = [
        _p(win=True),
        _p(win=True),
        _p(win=True),
        _p(),
        _p(team_id=TeamId.RED, win=True),
        _p(team_id=TeamId.RED),
        _p(team_id=TeamId.RED),
        _p(team_id=TeamId.RED),
    ]

    result = _assert_met(_evaluate(rows, {}, "prefers_blue_side"))

    assert result["value"] == pytest.approx(75.0)
    assert result["description"] == "Higher winrate on Blue Side (75%)."
    assert _evaluate(rows, {}, "prefers_red_side") is None


def test_side_preference_needs_both_sides_and_a_real_gap() -> None:
    one_sided = [_p(win=True), _p(), _p(), _p()]
    even = [
        _p(win=True),
        _p(),
        _p(),
        _p(),
        _p(team_id=TeamId.RED, win=True),
        _p(team_id=TeamId.RED),
        _p(team_id=TeamId.RED),
        _p(team_id=TeamId.RED),
    ]

    assert _evaluate(one_sided, {}, "prefers_blue_side") is None
    assert _evaluate(even, {}, "prefers_blue_side") is None
    assert _evaluate(even, {}, "prefers_red_side") is None


def _surrendered_games(
    games: list[tuple[bool, bool]],
) -> tuple[list[MatchParticipant], MatchesById]:
    """One participant row and one match per game, by (surrender, early)."""
    rows = [_p(match_id=f"EUN1_{i}") for i in range(len(games))]
    matches = {
        f"EUN1_{i}": _m(f"EUN1_{i}", [], surrender=surrender, early_surrender=early)
        for i, (surrender, early) in enumerate(games)
    }
    return rows, matches


def test_a_single_surrender_still_counts_as_never_surrendering() -> None:
    rows, matches = _surrendered_games([(False, False)] * 9 + [(True, False)])

    result = _assert_met(_evaluate(rows, matches, "never_surrender"))

    assert result["value"] == pytest.approx(10.0)
    assert result["description"] == "Surrenders 10% of games."


def test_an_early_surrender_vote_is_not_a_surrender() -> None:
    rows, matches = _surrendered_games([(False, False)] * 9 + [(True, True)])

    result = _assert_met(_evaluate(rows, matches, "never_surrender"))

    assert result["value"] == pytest.approx(0.0)
    assert result["description"] == "Surrenders 0% of games."


def test_ff15_needs_three_games_in_ten_and_a_match_record() -> None:
    often = _surrendered_games([(True, False)] * 3 + [(False, False)] * 7)
    rarely = _surrendered_games([(True, False)] * 2 + [(False, False)] * 8)

    result = _assert_met(_evaluate(often[0], often[1], "ff15"))
    assert result["value"] == pytest.approx(30.0)
    assert _evaluate(rarely[0], rarely[1], "ff15") is None
    assert _evaluate(rarely[0], {}, "ff15") is None


def _lane_gold_games(
    player_gold: int, opponent_gold: int
) -> tuple[list[MatchParticipant], MatchesById]:
    """Two TOP-lane games with the same gold relationship to the opponent."""
    rows: list[MatchParticipant] = []
    matches: MatchesById = {}
    for i in (1, 2):
        player = _p(match_id=f"EUN1_{i}", team_position="TOP", gold_earned=player_gold)
        opponent = _p(
            puuid=f"opponent{i}",
            match_id=f"EUN1_{i}",
            team_id=TeamId.RED,
            team_position="TOP",
            gold_earned=opponent_gold,
        )
        rows.append(player)
        matches[f"EUN1_{i}"] = _m(f"EUN1_{i}", [player, opponent])
    return rows, matches


def test_a_gold_lead_averages_over_the_lane_opponents() -> None:
    rows, matches = _lane_gold_games(player_gold=10_000, opponent_gold=8_000)

    result = _assert_met(_evaluate(rows, matches, "golden_leader"))

    assert result["value"] == pytest.approx(2000.0)
    assert result["description"] == "Averages 2,000 gold lead over lane opponent."
    small = _lane_gold_games(player_gold=10_000, opponent_gold=9_200)
    assert _evaluate(small[0], small[1], "golden_leader") is None


def test_a_gold_deficit_reads_the_deficit_branch() -> None:
    rows, matches = _lane_gold_games(player_gold=8_000, opponent_gold=10_000)

    result = _assert_met(_evaluate(rows, matches, "golden_deficiter"))

    assert result["value"] == pytest.approx(2000.0)
    assert result["description"] == "Averages 2,000 gold deficit to lane opponent."
    lead = _lane_gold_games(player_gold=10_000, opponent_gold=8_000)
    assert _evaluate(lead[0], lead[1], "golden_deficiter") is None


def test_gold_diff_without_a_lane_opponent_is_no_verdict() -> None:
    player = _p(match_id="EUN1_1", team_position="TOP", gold_earned=15_000)
    elsewhere = _p(puuid="opponent", team_id=TeamId.RED, team_position="MIDDLE")
    unmapped = _p(match_id="EUN1_2", team_position="TOP", gold_earned=15_000)

    matches = {"EUN1_1": _m("EUN1_1", [player, elsewhere])}

    assert _evaluate([player, unmapped], matches, "golden_leader") is None


def test_kill_greed_counts_games_by_non_solo_kills_per_assist() -> None:
    rows = [
        _p(match_id="EUN1_1", kills=6, solo_kills=0, assists=1),  # 6.0
        _p(match_id="EUN1_2", kills=8, solo_kills=0, assists=1),  # 8.0
        _p(match_id="EUN1_3", kills=2, solo_kills=0, assists=5),  # 0.4
        _p(match_id="EUN1_4", kills=4, solo_kills=4, assists=4),  # 0.0
    ]

    result = _assert_met(_evaluate(rows, _blank_matches_for(rows), "takes_all_kills"))

    assert result["value"] == pytest.approx(3.6)
    assert result["description"] == "Non-solo kills to assists ratio: 3.6:1."


def test_kill_greed_just_below_and_with_no_assists_to_divide_by() -> None:
    one_game = [
        _p(match_id="EUN1_1", kills=6, solo_kills=0, assists=1),
        _p(match_id="EUN1_2", kills=8, solo_kills=0, assists=8),  # 1.0, not greedy
        _p(match_id="EUN1_3", kills=2, solo_kills=0, assists=5),
        _p(match_id="EUN1_4", kills=4, solo_kills=4, assists=4),
    ]
    assert _evaluate(one_game, _blank_matches_for(one_game), "takes_all_kills") is None

    # No assists at all: 4 non-solo kills on their own already count.
    zero_assists = [_p(match_id="EUN1_1", kills=4, solo_kills=0, assists=0)]
    result = _assert_met(
        _evaluate(zero_assists, _blank_matches_for(zero_assists), "takes_all_kills")
    )
    assert result["value"] == pytest.approx(4.0)
    assert result["description"] == "Non-solo kills to assists ratio: 4:1."


def test_duelist_counts_games_by_solo_kills_per_assist() -> None:
    rows = [
        _p(match_id="EUN1_1", solo_kills=4, assists=1),  # 4.0
        _p(match_id="EUN1_2", solo_kills=4, assists=1),  # 4.0
        _p(match_id="EUN1_3", solo_kills=1, assists=4),  # 0.25
        _p(match_id="EUN1_4", solo_kills=0, assists=5),  # no solo kills: excluded
    ]

    result = _assert_met(_evaluate(rows, {}, "duelist"))

    assert result["value"] == pytest.approx(2.75)
    assert result["description"] == "Solo kills to assists ratio: 2.8:1."


def test_duelist_just_below_and_with_no_assists_to_divide_by() -> None:
    one_game = [
        _p(match_id="EUN1_1", solo_kills=4, assists=1),
        _p(match_id="EUN1_2", solo_kills=1, assists=4),
        _p(match_id="EUN1_3", solo_kills=0, assists=5),
        _p(match_id="EUN1_4", solo_kills=0, assists=2),
    ]
    assert _evaluate(one_game, {}, "duelist") is None

    zero_assists = [_p(match_id="EUN1_1", solo_kills=2, assists=0)]
    result = _assert_met(_evaluate(zero_assists, {}, "duelist"))
    assert result["value"] == pytest.approx(20.0)
    assert result["description"] == "Solo kills to assists ratio: 20:1."


def _objective_game(
    match_id: str, player_obj: int, teammate_obj: int
) -> tuple[MatchParticipant, Match]:
    """One game: the player, one teammate, and an enemy with huge objective damage.

    The enemy is there to fail loudly if the share ever stops counting only
    the player's own team.
    """
    player = _p(match_id=match_id, damage_dealt_to_objectives=player_obj)
    teammate = _p(
        puuid="mate", match_id=match_id, damage_dealt_to_objectives=teammate_obj
    )
    enemy = _p(
        puuid="foe",
        match_id=match_id,
        team_id=TeamId.RED,
        damage_dealt_to_objectives=9_999,
    )
    return player, _m(match_id, [player, teammate, enemy])


def test_ignores_objectives_counts_games_below_the_team_share_line() -> None:
    games = [
        _objective_game("EUN1_1", 90, 910),  # 9%
        _objective_game("EUN1_2", 90, 910),  # 9%
        _objective_game("EUN1_3", 200, 800),  # 20%
        _objective_game("EUN1_4", 100, 900),  # exactly 10%: not below the line
    ]
    rows = [player for player, _ in games]
    matches = {match.match_id: match for _, match in games}

    result = _assert_met(_evaluate(rows, matches, "ignores_objectives"))

    assert result["value"] == pytest.approx(12.0)
    assert result["description"] == "Averages 12% of team's objective damage."


def test_ignores_objectives_just_below_the_game_percentage() -> None:
    games = [
        _objective_game("EUN1_1", 90, 910),  # 9%
        _objective_game("EUN1_2", 200, 800),  # 20%
        _objective_game("EUN1_3", 200, 800),  # 20%
        _objective_game("EUN1_4", 100, 900),  # 10%, not below the line
    ]
    rows = [player for player, _ in games]
    matches = {match.match_id: match for _, match in games}

    assert _evaluate(rows, matches, "ignores_objectives") is None


def test_nolifer_reads_the_summoner_level() -> None:
    result = _assert_met(_evaluate([_p(summoner_level=500)], {}, "nolifer"))
    assert result["value"] == 500
    assert result["description"] == "Summoner Level 500."
    assert _evaluate([_p(summoner_level=499)], {}, "nolifer") is None
    assert _evaluate([_p(summoner_level=None)], {}, "nolifer") is None


def test_otp_and_main_champion_rates_name_the_champion() -> None:
    mostly_ahri = [_p(champion_name="Ahri") for _ in range(9)] + [
        _p(champion_name="Yasuo")
    ]
    often_ahri = [_p(champion_name="Ahri") for _ in range(7)] + [
        _p(champion_name="Yasuo") for _ in range(3)
    ]

    otp = _assert_met(_evaluate(mostly_ahri, {}, "otp"))
    assert otp["value"] == pytest.approx(90.0)
    assert otp["description"] == "Plays Ahri in 90% of games."
    assert otp["display_name"] == "Ahri OTP"
    assert _evaluate(often_ahri, {}, "otp") is None

    half = [_p(champion_name="Ahri") for _ in range(5)] + [
        _p(champion_name="Yasuo") for _ in range(5)
    ]
    main = _assert_met(_evaluate(half, {}, "main_champion"))
    assert main["value"] == pytest.approx(50.0)
    assert main["display_name"] == "Ahri Main"


def test_main_role_names_the_role_and_skips_unknown_positions() -> None:
    rows = (
        [_p(team_position="TOP") for _ in range(6)]
        + [_p(team_position="MIDDLE") for _ in range(2)]
        + [_p(team_position="UNKNOWN") for _ in range(2)]
    )

    result = _assert_met(_evaluate(rows, {}, "main_role"))

    assert result["value"] == pytest.approx(60.0)
    assert result["description"] == "Plays Top in 60% of games."
    assert result["display_name"] == "Top Main"


def test_main_role_below_the_rate_bar_is_no_verdict() -> None:
    rows = [_p(team_position="TOP") for _ in range(4)] + [
        _p(team_position="UNKNOWN") for _ in range(6)
    ]

    assert _evaluate(rows, {}, "main_role") is None


def test_format_value_rounds_displays() -> None:
    assert format_value(2500.0) == "2,500"
    assert format_value(6.0) == "6"
    assert format_value(3.75) == "3.8"
    assert format_value(50) == "50"
