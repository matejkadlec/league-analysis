"""`platform` has exactly one stored spelling.

Five write paths disagreed about the casing of `core.players.platform` while
two lookups compared it case-sensitively, so a player whose row was created by
a match sync was stored lowercase and then could not be found by name and tag.
Two other read paths had already been patched around it individually — one with
`ilike`, one with `lower()` — which is what a convention nobody enforces looks
like on its way to becoming a bug.

The database now holds the invariant (`ck_players_platform_is_lowercase`), so
these tests cover the half a check constraint cannot: that the values the
application *sends* are already canonical, and that the lookups compare against
the same spelling the writers produce.
"""

from __future__ import annotations

from types import ModuleType, SimpleNamespace
from typing import cast

import pytest
from sqlalchemy import Select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import PlayerServiceError
from app.core.riot_api.constants import Platform, normalize_platform
from app.features.players.service import PlayerService

# Compiling a `Player` SELECT configures the mapper, and its relationships are
# resolved by name, so every related mapper has to be registered first.
from app.features.auth import models as _auth_models  # isort:skip
from app.features.matches import models as _match_models  # isort:skip
from app.features.matchmaking_analysis import models as _mm_models  # isort:skip
from app.features.players import leagues as _league_models  # isort:skip
from app.features.playstyle_analysis import models as _ps_models  # isort:skip

# Naming the modules keeps the imports above from looking unused to a linter
# while preserving the reason they exist.
_RELATED_MAPPERS: tuple[ModuleType, ...] = (
    _auth_models,
    _match_models,
    _mm_models,
    _league_models,
    _ps_models,
)


def _no_players() -> list[object]:
    """An empty result, typed so the fake satisfies strict mode."""
    return []


class _CapturingSession:
    """Session that records the SELECTs a lookup issues."""

    def __init__(self) -> None:
        self.executed: list[Select[tuple[object]]] = []

    async def execute(self, statement: Select[tuple[object]]) -> SimpleNamespace:
        self.executed.append(statement)
        return SimpleNamespace(
            scalar_one_or_none=lambda: None,
            scalars=lambda: SimpleNamespace(all=_no_players),
        )


def _bound_platform(statement: Select[tuple[object]]) -> str | None:
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


@pytest.mark.asyncio
async def test_name_and_tag_lookup_compares_against_canonical_casing() -> None:
    """The lookup that could not find match-created players now matches them."""
    session = _CapturingSession()
    service = PlayerService(cast(AsyncSession, session))

    # The lookup raises when nothing matches; the query it issued first is
    # what this test is about.
    with pytest.raises(PlayerServiceError):
        await service.get_player_by_name_and_tag("Name", "TAG", "EUN1")

    assert len(session.executed) == 1
    assert _bound_platform(session.executed[0]) == "eun1"


@pytest.mark.asyncio
async def test_game_name_search_compares_against_canonical_casing() -> None:
    """The sibling lookup normalises identically."""
    session = _CapturingSession()
    service = PlayerService(cast(AsyncSession, session))

    with pytest.raises(PlayerServiceError):
        await service.get_player_by_game_name("Name", "EUN1")

    assert len(session.executed) == 1
    assert _bound_platform(session.executed[0]) == "eun1"
