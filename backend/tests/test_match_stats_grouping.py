"""Characterise champion and lane statistic aggregation.

`match_stats.py` had no test of any kind: nothing in `tests/` imported these
functions and no route test reaches `/champion-stats` or `/lane-stats`. They
are pure, so the absence was cheap to fix and expensive to leave -- the two
accumulators and the two builders were near-copies, and a copy nobody checks is
where the two halves quietly stop agreeing.

Written to pass against the pre-refactor implementation as well, so it says
what the code does rather than what the refactor happened to produce.
"""

import pytest

from app.features.matches.match_stats import (
    accumulate_champion_stats,
    accumulate_lane_stats,
    build_champion_stat_items,
    build_lane_stat_items,
    calculate_kda,
    common_stat_fields,
)
from app.features.matches.participants import MatchParticipant
from app.model_registry import import_all_models

# `MatchParticipant` has a `relationship("Match")`, so instantiating one -- even
# with no session anywhere in sight -- forces SQLAlchemy to configure every
# mapper, and configuration fails unless the whole registry has been imported.
import_all_models()


def participant(
    *,
    champion_name: str = "Ahri",
    champion_id: int = 103,
    team_position: str | None = "MIDDLE",
    win: bool = True,
    kills: int = 3,
    deaths: int = 1,
    assists: int = 5,
) -> MatchParticipant:
    row = MatchParticipant()
    row.champion_name = champion_name
    row.champion_id = champion_id
    row.team_position = team_position
    row.win = win
    row.kills = kills
    row.deaths = deaths
    row.assists = assists
    return row


def test_champion_totals_sum_per_champion() -> None:
    totals = accumulate_champion_stats(
        [
            participant(kills=3, deaths=1, assists=5, win=True),
            participant(kills=1, deaths=4, assists=2, win=False),
            participant(champion_name="Zed", champion_id=238, win=True),
        ]
    )

    assert totals["Ahri"] == {
        "champion_id": 103,
        "games": 2,
        "wins": 1,
        "kills": 4,
        "deaths": 5,
        "assists": 7,
    }
    assert totals["Zed"]["champion_id"] == 238
    assert totals["Zed"]["games"] == 1


def test_champion_id_is_taken_from_the_first_row_not_the_last() -> None:
    # It is copied, not summed. Adding it to the totals would produce a
    # champion id in the hundreds of thousands after a few games.
    totals = accumulate_champion_stats(
        [
            participant(champion_id=103),
            participant(champion_id=999),
        ]
    )

    assert totals["Ahri"]["champion_id"] == 103


def test_lane_totals_skip_rows_with_no_lane() -> None:
    # `team_position` is nullable -- an arena or a remake has no lane, and
    # counting those under a blank key would put a nameless row in the response.
    totals = accumulate_lane_stats(
        [
            participant(team_position="TOP"),
            participant(team_position=None),
            participant(team_position=""),
            participant(team_position="TOP", win=False),
        ]
    )

    assert list(totals) == ["TOP"]
    assert totals["TOP"]["games"] == 2
    assert totals["TOP"]["wins"] == 1


def test_a_nameless_champion_is_skipped_rather_than_grouped_under_nothing() -> None:
    # The one intended behaviour change from sharing an accumulator with the
    # lane path. `champion_name` is NOT NULL so this is a data defect either
    # way, but it used to produce a row with a blank champion name in the
    # response; now it produces no row.
    totals = accumulate_champion_stats(
        [participant(champion_name=""), participant(champion_name="Ahri")]
    )

    assert list(totals) == ["Ahri"]


def test_lane_totals_carry_no_champion_id() -> None:
    totals = accumulate_lane_stats([participant(team_position="JUNGLE")])

    assert "champion_id" not in totals["JUNGLE"]


@pytest.mark.parametrize(
    ("kills", "deaths", "assists", "expected"),
    [(3, 1, 5, 8.0), (3, 0, 5, 8.0), (0, 2, 0, 0.0)],
)
def test_kda_treats_a_deathless_game_as_one_death_worth(
    kills: int, deaths: int, assists: int, expected: float
) -> None:
    assert calculate_kda(kills, deaths, assists) == expected


def test_averages_of_an_empty_group_do_not_divide_by_zero() -> None:
    fields = common_stat_fields(
        {"games": 0, "wins": 0, "kills": 0, "deaths": 0, "assists": 0}
    )

    assert fields == {
        "games_played": 0,
        "wins": 0,
        "losses": 0,
        "win_rate": 0.0,
        "avg_kills": 0.0,
        "avg_deaths": 0.0,
        "avg_assists": 0.0,
        "avg_kda": 0.0,
    }


def test_champion_items_sort_by_games_then_name() -> None:
    items = build_champion_stat_items(
        {
            "Zed": {
                "champion_id": 238,
                "games": 2,
                "wins": 1,
                "kills": 2,
                "deaths": 2,
                "assists": 2,
            },
            "Ahri": {
                "champion_id": 103,
                "games": 2,
                "wins": 2,
                "kills": 4,
                "deaths": 2,
                "assists": 6,
            },
            "Yasuo": {
                "champion_id": 157,
                "games": 5,
                "wins": 0,
                "kills": 0,
                "deaths": 10,
                "assists": 0,
            },
        }
    )

    # Most games first; ties broken alphabetically, not by insertion order.
    assert [item.champion_name for item in items] == ["Yasuo", "Ahri", "Zed"]
    ahri = items[1]
    assert ahri.champion_id == 103
    assert ahri.wins == 2
    assert ahri.losses == 0
    assert ahri.win_rate == 1.0
    assert ahri.avg_kills == 2.0
    assert ahri.avg_assists == 3.0


def test_lane_items_are_renamed_for_display_and_sorted_by_games() -> None:
    items = build_lane_stat_items(
        {
            "UTILITY": {"games": 1, "wins": 1, "kills": 0, "deaths": 0, "assists": 9},
            "MIDDLE": {"games": 4, "wins": 2, "kills": 8, "deaths": 4, "assists": 4},
        }
    )

    assert [item.lane for item in items] == ["Mid", "Support"]
    assert items[0].games_played == 4
    assert items[0].win_rate == 0.5
    assert items[0].avg_deaths == 1.0


def test_an_unknown_lane_keeps_its_raw_name() -> None:
    items = build_lane_stat_items(
        {"AFK": {"games": 1, "wins": 0, "kills": 0, "deaths": 1, "assists": 0}}
    )

    assert items[0].lane == "AFK"
