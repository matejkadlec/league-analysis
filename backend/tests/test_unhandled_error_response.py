"""Every unmapped route failure answers the one client-safe 500 body.

The routers used to hand-roll that tail themselves; the app-level handler in
`app.main` now owns it, and nothing else pins it.
"""

import warnings
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock

import httpx
from starlette.exceptions import StarletteDeprecationWarning

from app.core.http_errors import SERVICE_ERROR_DETAIL
from app.features.players.dependencies import get_player_service
from app.main import app

with warnings.catch_warnings():
    # The suite treats warnings as errors, and starlette's TestClient still
    # warns at import time while it runs on httpx instead of httpx2.
    warnings.simplefilter("ignore", StarletteDeprecationWarning)
    from starlette.testclient import TestClient


def test_an_unmapped_route_failure_answers_the_service_error_detail() -> None:
    app.dependency_overrides[get_player_service] = lambda: SimpleNamespace(
        get_player_league=AsyncMock(side_effect=RuntimeError("boom"))
    )
    # No `with`: entering the lifespan would demand a live Postgres.
    client = TestClient(app, raise_server_exceptions=False)
    try:
        response = cast(
            httpx.Response,
            client.get("/api/v1/players/some-puuid/league"),  # pyright: ignore[reportUnknownMemberType]
        )
    finally:
        del app.dependency_overrides[get_player_service]

    assert response.status_code == 500
    assert response.json() == {"detail": SERVICE_ERROR_DETAIL}
