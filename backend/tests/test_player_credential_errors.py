"""Riot credential rejections must surface the structured detail, not a 500.

Development keys expire with a 403 (ForbiddenError), production revocations
with a 401 (AuthenticationError). Both must map to the same structured
RIOT_API_KEY_INVALID detail so the frontend can classify them.
"""

from typing import cast
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from app.core.riot_api.constants import Platform
from app.core.riot_api.errors import (
    RIOT_API_KEY_INVALID_DETAIL,
    AuthenticationError,
    ForbiddenError,
    NotFoundError,
    RateLimitError,
)
from app.features.players.router import discover_player
from route_helpers import loopback_request, undecorated


@pytest.mark.parametrize(
    "credential_error",
    [
        AuthenticationError("credential rejected", status_code=401),
        ForbiddenError("access forbidden", status_code=403),
    ],
    ids=["status-401", "status-403"],
)
async def test_credential_rejection_maps_to_structured_detail(
    credential_error: Exception,
) -> None:
    service = MagicMock()
    service.discover_player = AsyncMock(side_effect=credential_error)

    with pytest.raises(HTTPException) as error:
        await undecorated(discover_player)(
            request=loopback_request(),
            player_service=service,
            riot_client=MagicMock(),
            _current_user=MagicMock(),
            game_name="SomeName",
            tag_line="1234",
            platform=Platform("eun1"),
        )

    assert error.value.status_code == 503
    detail = cast(dict[str, str], error.value.detail)
    assert detail == RIOT_API_KEY_INVALID_DETAIL
    # The message must stay free of internal identifiers.
    assert "401" not in detail["message"]
    assert "403" not in detail["message"]


@pytest.mark.parametrize(
    ("riot_error", "expected_status", "expected_detail"),
    [
        (
            NotFoundError("Resource not found", status_code=404),
            404,
            "Player not found",
        ),
        (
            RateLimitError("Rate limit exceeded", status_code=429, retry_after=10),
            429,
            "Riot API rate limit reached",
        ),
    ],
    ids=["status-404", "status-429"],
)
async def test_riot_lookup_failures_keep_their_own_status(
    riot_error: Exception, expected_status: int, expected_detail: str
) -> None:
    """A missing account and a live 429 must not collapse into a generic 500.

    The client words "wasn't found on server X" from the 404 and backs off on
    the 429; both readings are lost if either becomes a server error.
    """
    service = MagicMock()
    service.discover_player = AsyncMock(side_effect=riot_error)

    with pytest.raises(HTTPException) as error:
        await undecorated(discover_player)(
            request=loopback_request(),
            player_service=service,
            riot_client=MagicMock(),
            _current_user=MagicMock(),
            game_name="SomeName",
            tag_line="1234",
            platform=Platform("eun1"),
        )

    assert error.value.status_code == expected_status
    assert error.value.detail == expected_detail
