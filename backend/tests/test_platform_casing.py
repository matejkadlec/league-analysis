"""`platform` has exactly one stored spelling.

The database holds the invariant (`ck_players_platform_is_lowercase`), so these
tests cover the half a check constraint cannot: that the values the application
*sends* are already canonical, and that lookups compare against that spelling.
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

    The column is `varchar(4)` under a lowercase check constraint, so a new
    Riot platform stores cleanly -- and then fails `PlayerResponse`, whose
    field is the enum: a 500 on the player routes and in the writer jobs.
    """
    with pytest.raises(ValueError):
        normalize_platform(unknown)


def test_normalize_platform_is_idempotent() -> None:
    """Normalising a stored value again must not change it."""
    for member in Platform:
        assert normalize_platform(normalize_platform(member)) == member.value


def test_platform_enum_values_are_already_canonical() -> None:
    """The enum is the definition of canonical, so it must satisfy it.

    If a member were ever added in upper case, `normalize_platform` and the
    check constraint would disagree with the enum and every lookup built from
    it would silently miss.
    """
    assert [member.value for member in Platform] == [
        normalize_platform(member) for member in Platform
    ]


def test_the_player_lookup_compares_against_canonical_casing() -> None:
    """The one remaining platform-filtered lookup binds the stored spelling.

    The column is lowercase by check constraint and the parameter is the enum,
    so an equality comparison is both correct and index-usable -- but only
    while the value being bound is the enum's own.
    """
    statement = build_player_search_query(Platform.EUN1, "name", "faker", "faker", None)

    assert _bound_platform(statement) == "eun1"
    assert "core.players.platform = " in str(statement.whereclause)


def test_a_search_without_a_platform_filters_on_no_platform_at_all() -> None:
    """`None` means every region, not the default one."""
    statement = build_player_search_query(None, "name", "faker", "faker", None)

    assert "core.players.platform" not in str(statement.whereclause)
