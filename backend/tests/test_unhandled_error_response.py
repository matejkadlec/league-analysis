"""Every unmapped route failure answers the one client-safe 500 body.

The routers used to hand-roll that tail themselves; the app-level handler in
`app.main` now owns it, and nothing else pins it.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx

from app.core.http_errors import SERVICE_ERROR_DETAIL
from app.features.players.dependencies import get_player_service
from app.main import app


async def test_an_unmapped_route_failure_answers_the_service_error_detail() -> None:
    app.dependency_overrides[get_player_service] = lambda: SimpleNamespace(
        get_player_league=AsyncMock(side_effect=RuntimeError("boom"))
    )
    # `ASGITransport` drives no lifespan, which is what this wants: entering it
    # would demand a live Postgres. `raise_app_exceptions=False` is its spelling
    # of the TestClient's `raise_server_exceptions=False`.
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    try:
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as client:
            response = await client.get("/api/v1/players/some-puuid/league")
    finally:
        del app.dependency_overrides[get_player_service]

    assert response.status_code == 500
    assert response.json() == {"detail": SERVICE_ERROR_DETAIL}
