"""What `score_player_match` ranks, and which fields each search type reads.

These pin the parts that are choices rather than arithmetic: the exact-match
short circuit, and the three deliberately different field sets.
"""

import pytest

from app.features.players.models import Player
from app.features.players.player_search import SearchType, score_player_match


def player(game_name: str = "Faker", tag_line: str = "KR1") -> Player:
    return Player(puuid="p", game_name=game_name, tag_line=tag_line, platform="eun1")


def test_a_full_id_that_matches_exactly_outranks_every_fuzzy_hit() -> None:
    assert (
        score_player_match(player(), "full_id", "faker#kr1", "Faker", "KR1") == 1000.0
    )
    # Case is not part of the comparison.
    assert (
        score_player_match(
            player("faker", "kr1"), "full_id", "faker#kr1", "FAKER", "KR1"
        )
        == 1000.0
    )
    # The short circuit is full_id only; the same pair under another type scores
    # on distance instead.
    assert score_player_match(player(), "all", "faker", "Faker", "KR1") < 1000.0


@pytest.mark.parametrize(
    ("search_type", "query", "expected"),
    [
        # A tag search never reads the game name...
        ("tag", "kr1", 1.0),
        # ...and a name search only ever sees the tag inside the full Riot ID,
        # so a bare tag is 4 edits away from the closest field it compares.
        ("name", "kr1", pytest.approx(1 / 5)),
        ("name", "faker", 1.0),
        ("full_id", "faker#kr1", 1.0),
        ("all", "faker", 1.0),
    ],
)
def test_each_search_type_compares_its_own_fields(
    search_type: SearchType, query: str, expected: float
) -> None:
    assert score_player_match(player(), search_type, query, None, None) == expected
