"""Riot credential rejections must surface the structured detail, not a 500.

Development keys expire with a 403 (ForbiddenError), production revocations
with a 401 (AuthenticationError). Both must map to the same structured
RIOT_API_KEY_INVALID detail so the frontend can classify them.
"""

import inspect
from collections.abc import Callable
from typing import cast
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.core.riot_api.constants import Platform
from app.core.riot_api.errors import (
    RIOT_API_KEY_INVALID_DETAIL,
    AuthenticationError,
    ForbiddenError,
)
from app.features.players.router import discover_player


def _request() -> Request:
    """Build the minimal request required by rate-limited route wrappers."""
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/",
            "headers": [],
            "client": ("127.0.0.1", 12345),
        }
    )


def _unwrapped[**P, R](endpoint: Callable[P, R]) -> Callable[P, R]:
    """Reach the endpoint under slowapi's rate-limit wrapper, signature intact."""
    return cast(Callable[P, R], inspect.unwrap(endpoint))


@pytest.mark.asyncio
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
        await _unwrapped(discover_player)(
            request=_request(),
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
