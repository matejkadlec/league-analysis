"""Two endpoints answering with the same player answer with the same player.

`GET /players/{puuid}` and the `current_player` on `GET /players/context` both
return a `PlayerResponse` for one row of `core.players`, and callers have no
way to tell which one produced the object they are holding. They were not
built the same way: only the first filled `total_matches` and
`analyzed_matches`, and `PlayerResponse` defaults both to 0, so the context
endpoint reported every player as having no matches at all.

Nothing read those two fields off a context player, so nothing broke -- until
the frontend began seeding its `["player", puuid]` cache from the context
response, at which point the zeros became what every route displayed. The
divergence is the defect, not the symptom, so this pins the shapes together
rather than pinning the frontend's use of them.
"""

from datetime import UTC, datetime
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock

from sqlalchemy.ext.asyncio import AsyncSession

from app.features.players.service import PlayerService

PUUID = "p" * 78
USER_ID = 7

# Deliberately not (0, 0): the bug this file exists for was two zeros where
# real counts belonged, so a fixture of zeros could not tell the two apart.
TOTAL_MATCHES = 137
ANALYZED_MATCHES = 129


def _player_row() -> SimpleNamespace:
    """One `core.players` row, as `PlayerResponse.model_validate` reads it."""
    moment = datetime(2026, 8, 1, tzinfo=UTC)
    return SimpleNamespace(
        puuid=PUUID,
        game_name="Player",
        tag_line="EUNE",
        platform="eun1",
        summoner_level=300,
        profile_icon_id=1,
        created_at=moment,
        updated_at=moment,
        last_playstyle_analysis=None,
        last_matchmaking_analysis=None,
        profile_synced_at=moment,
        league_synced_at=moment,
        match_synced_at=moment,
    )


def _service(player: SimpleNamespace) -> PlayerService:
    """A service whose every DB touch answers for this one player.

    The counts are stubbed rather than queried: what is under test is which
    code path assigns them, not the two `SELECT count(*)` statements, and a
    mocked session cannot run those anyway.
    """
    db = SimpleNamespace(
        execute=AsyncMock(
            return_value=SimpleNamespace(scalar_one_or_none=lambda: player)
        ),
        get=AsyncMock(return_value=player),
        scalar=AsyncMock(return_value=SimpleNamespace(current_player_puuid=PUUID)),
        commit=AsyncMock(),
        flush=AsyncMock(),
    )
    service = PlayerService(cast(AsyncSession, db))
    service._match_counts = AsyncMock(return_value=(TOTAL_MATCHES, ANALYZED_MATCHES))
    service._is_player_tracked_by_user = AsyncMock(return_value=True)
    return service


async def test_the_context_player_is_the_same_object_the_player_route_returns() -> None:
    player = _player_row()

    direct = await _service(player).get_player_by_puuid(PUUID, USER_ID)
    context = await _service(player).get_player_context(USER_ID)

    assert context.current_player == direct


async def test_the_context_player_carries_its_match_counts() -> None:
    """The half that names the defect, so a failure reads as what it is.

    Equality above would also fail if the *direct* route lost its counts;
    this says which side the zeros were on.
    """
    context = await _service(_player_row()).get_player_context(USER_ID)

    assert context.current_player is not None
    assert context.current_player.total_matches == TOTAL_MATCHES
    assert context.current_player.analyzed_matches == ANALYZED_MATCHES
