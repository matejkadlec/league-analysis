"""`platform` has exactly one stored spelling.

The check constraint holds the stored half; these cover the half it cannot:
that the values sent, and the values compared against, are already canonical.
"""

from __future__ import annotations

import pytest
from sqlalchemy import Select

from app.core.riot_api.constants import Platform, normalize_platform
from app.features.players.models import Player
from app.features.players.player_search import build_player_search_query


def _bound_platform(statement: Select[tuple[Player]]) -> str | None:
    """Return the platform value a compiled lookup actually compares against."""
    for value in statement.compile().params.values():
        if isinstance(value, str) and value.lower() in {
            member.value for member in Platform
        }:
            return value
    return None


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("EUN1", "eun1"),
        ("eun1", "eun1"),
        ("  EuN1  ", "eun1"),
        (Platform.EUW1, "euw1"),
        ("KR", "kr"),
    ],
)
def test_normalize_platform_is_canonical(raw: str | Platform, expected: str) -> None:
    """Every spelling a caller might hold collapses to Riot's own."""
    assert normalize_platform(raw) == expected


@pytest.mark.parametrize("unknown", ["me1", "ME1", "EUNE", "", "not-a-platform"])
def test_normalize_platform_refuses_an_id_riot_does_not_have(unknown: str) -> None:
    """An unknown region is refused here or it becomes a row nobody can read.

    A new Riot platform stores cleanly under the check constraint and then fails
    `PlayerResponse`, whose field is the enum: a 500 on the player routes.
    """
    with pytest.raises(ValueError, match="is not a valid Platform"):
        normalize_platform(unknown)


def test_platform_enum_values_are_already_canonical() -> None:
    """The enum is the definition of canonical, so it must satisfy it.

    A member added in upper case would disagree with `normalize_platform` and
    the check constraint, and every lookup built from it would silently miss.
    """
    assert [member.value for member in Platform] == [
        normalize_platform(member) for member in Platform
    ]


def test_the_player_lookup_compares_against_canonical_casing() -> None:
    """The one remaining platform-filtered lookup binds the stored spelling.

    Equality is correct and index-usable only while the bound value is the
    enum's own, matching the column's lowercase check constraint.
    """
    statement = build_player_search_query(Platform.EUN1, "name", "faker", "faker", None)

    assert _bound_platform(statement) == "eun1"
    assert "core.players.platform = " in str(statement.whereclause)


def test_a_search_without_a_platform_filters_on_no_platform_at_all() -> None:
    """`None` means every region, not the default one."""
    statement = build_player_search_query(None, "name", "faker", "faker", None)

    assert "core.players.platform" not in str(statement.whereclause)
