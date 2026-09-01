"""Tracking failures pick their status from the exception type, not the prose.

Classifying on `"not found" in str(e).lower()` makes the status a property of
the English sentence, so rewording a message moves it between 404 and 400.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from app.core.riot_api.constants import Platform
from app.features.players.router import discover_player, track_player
from app.features.players.service import (
    PlayerNotFoundError,
    TrackingLimitReachedError,
)
from route_helpers import loopback_request, undecorated


async def _track(error: Exception) -> HTTPException:
    service = MagicMock()
    service.track_player = AsyncMock(side_effect=error)

    with pytest.raises(HTTPException) as raised:
        await undecorated(track_player)(
            request=loopback_request(),
            puuid="puuid-1",
            player_service=service,
            background_tasks=MagicMock(),
            current_user=MagicMock(),
        )
    return raised.value


@pytest.mark.parametrize(
    ("error", "expected_status"),
    [
        (PlayerNotFoundError("Player not found."), 404),
        (TrackingLimitReachedError("You can track up to 10 players."), 400),
    ],
    ids=["not-found", "limit-reached"],
)
async def test_track_player_maps_each_failure_to_its_own_status(
    error: Exception, expected_status: int
) -> None:
    assert (await _track(error)).status_code == expected_status


@pytest.mark.parametrize(
    "message",
    ["Player not found.", "You can track up to 10 players."],
    ids=["reads-as-404", "reads-as-400"],
)
async def test_track_player_does_not_classify_a_bare_value_error(message: str) -> None:
    """A plain `ValueError` is a bug, whatever its sentence happens to say.

    Answering 400 told the viewer their request was invalid and hid the fault;
    it now propagates to the unhandled-error handler, which is a 500.
    """
    with pytest.raises(ValueError, match=message):
        await _track(ValueError(message))


async def test_discover_player_does_not_classify_a_bare_value_error() -> None:
    service = MagicMock()
    service.discover_player = AsyncMock(side_effect=ValueError("not found in cache"))

    with pytest.raises(ValueError, match="not found in cache"):
        await undecorated(discover_player)(
            request=loopback_request(),
            player_service=service,
            riot_client=MagicMock(),
            current_user=MagicMock(),
            game_name="SomeName",
            tag_line="1234",
            platform=Platform("eun1"),
        )
