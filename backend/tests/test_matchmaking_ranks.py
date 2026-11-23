"""Pure rank-scale and duo-classification rules for matchmaking analysis."""

import pytest

from app.features.matchmaking_analysis.ranks import (
    classify_duo_matches,
    player_rank_map,
    rank_value,
    summarize_ranks,
)
from app.features.matchmaking_analysis.service import (
    MATCHES_FOR_WINRATE,
    league_v4_max_requests,
    match_v5_max_requests,
    theoretical_max_requests,
)

# Shared with the frontend formatter test (rank-display.test.ts): the same
# triples must produce the same values and display strings on both sides, or
# the two implementations of the scale drift apart silently.
SCALE_FIXTURES = [
    ("IRON", "IV", 0, 0, "Iron IV · 0 LP"),
    ("IRON", "IV", 99, 99, "Iron IV · 99 LP"),
    ("SILVER", "II", 40, 1040, "Silver II · 40 LP"),
    ("GOLD", "I", 75, 1575, "Gold I · 75 LP"),
    ("EMERALD", "III", 20, 2120, "Emerald III · 20 LP"),
    ("DIAMOND", "I", 0, 2700, "Diamond I · 0 LP"),
    # The DIAMOND -> MASTER boundary: DIAMOND I 100 LP == MASTER 0 LP.
    ("DIAMOND", "I", 100, 2800, "Diamond I"),
    ("MASTER", None, 0, 2800, "Master"),
    ("GRANDMASTER", None, 250, 3050, "Grandmaster"),
    ("CHALLENGER", None, 1200, 4000, "Challenger"),
]


@pytest.mark.parametrize(
    ("tier", "division", "lp", "expected", "_display"),
    SCALE_FIXTURES,
)
def test_rank_value_matches_the_shared_scale_fixtures(
    tier: str, division: str | None, lp: int, expected: int, _display: str
) -> None:
    assert rank_value(tier, division, lp) == expected


def test_summary_excludes_unranked_from_the_average_but_counts_them() -> None:
    summary = summarize_ranks(
        ally_puuids={"a", "b", "c"},
        enemy_puuids={"d"},
        tiers={"a": "GOLD", "b": "GOLD", "d": "SILVER"},
        values={"a": 1500, "b": 1600, "c": None, "d": 1000},
    )

    assert summary.ally_avg_rank_value == pytest.approx(1550.0)
    assert summary.ally_tier_counts == {"GOLD": 2, "UNRANKED": 1}
    assert summary.enemy_avg_rank_value == pytest.approx(1000.0)
    assert summary.enemy_tier_counts == {"SILVER": 1}


def test_player_rank_map_marks_unknown_players_unranked() -> None:
    ranks = player_rank_map(
        {"a", "b"}, tiers={"a": "GOLD"}, values={"a": 1500, "b": None}
    )

    assert ranks == {
        "a": {"tier": "GOLD", "value": 1500},
        "b": {"tier": "UNRANKED", "value": None},
    }


def test_summary_of_no_ranked_players_is_none_not_zero() -> None:
    # A 0 here renders as "average rank Iron IV", the resurrected version of
    # the "0% average winrate" bug.
    summary = summarize_ranks({"a"}, set(), {}, {"a": None})

    assert summary.ally_avg_rank_value is None
    assert summary.enemy_avg_rank_value is None


def test_no_recurring_teammates_means_no_duo_matches() -> None:
    flags = classify_duo_matches(
        [
            ("m1", ["a", "b", "c", "d"]),
            ("m2", ["e", "f", "g", "h"]),
        ],
        analyzed_puuid="self",
    )

    assert flags == {"m1": False, "m2": False}


def test_a_teammate_in_two_matches_flags_both_as_duo() -> None:
    flags = classify_duo_matches(
        [
            ("m1", ["partner", "b", "c", "d"]),
            ("m2", ["partner", "f", "g", "h"]),
            ("m3", ["i", "j", "k", "l"]),
        ],
        analyzed_puuid="self",
    )

    assert flags == {"m1": True, "m2": True, "m3": False}


def test_a_duplicate_within_one_match_does_not_count_as_recurrence() -> None:
    # Defensive: the same puuid twice in one match's list is one appearance.
    flags = classify_duo_matches([("m1", ["a", "a", "b", "c"])], analyzed_puuid="self")

    assert flags == {"m1": False}


def test_the_analyzed_player_in_every_match_is_not_a_duo() -> None:
    flags = classify_duo_matches(
        [
            ("m1", ["self", "a", "b", "c"]),
            ("m2", ["self", "e", "f", "g"]),
        ],
        analyzed_puuid="self",
    )

    assert flags == {"m1": False, "m2": False}


def test_unknown_tier_is_refused_rather_than_counted_as_iron() -> None:
    with pytest.raises(ValueError, match="Unknown tier"):
        rank_value("WOOD", "I", 50)


def test_one_spine_match_costs_a_full_sample_for_each_of_nine_players() -> None:
    # The spine list, nine match lists, the spine detail, and ten sample
    # details for each of the nine: the spine match is in no sample (LGA-140),
    # so none of the ten is already known.
    assert match_v5_max_requests(1) == 1 + 9 + 1 + 9 * MATCHES_FOR_WINRATE
    # One rank read per unique player, the analyzed player included.
    assert league_v4_max_requests(1) == 10


@pytest.mark.parametrize("spine_size", [1, 5, 10, 30])
def test_the_request_maximum_is_both_hosts_together(spine_size: int) -> None:
    assert theoretical_max_requests(spine_size) == match_v5_max_requests(
        spine_size
    ) + league_v4_max_requests(spine_size)
