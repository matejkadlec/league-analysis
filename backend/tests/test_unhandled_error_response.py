"""Every unmapped route failure answers the one client-safe 500 body.

The routers used to hand-roll that tail themselves; the app-level handler in
`app.main` now owns it, and nothing else pins it.
"""

from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock

import httpx

from app.core.http_errors import SERVICE_ERROR_DETAIL
from app.features.auth.dependencies import get_current_active_user
from app.features.auth.users.models import User
from app.features.players.dependencies import get_player_service
from app.main import app


async def test_an_unmapped_route_failure_answers_the_service_error_detail() -> None:
    app.dependency_overrides[get_player_service] = lambda: SimpleNamespace(
        get_player_league=AsyncMock(side_effect=RuntimeError("boom"))
    )
    # The route is signed-in-only now; without this the request would be
    # answered by the auth dependency's 401 and never reach the failure.
    app.dependency_overrides[get_current_active_user] = lambda: cast(
        User, SimpleNamespace(id=1, is_active=True)
    )
    # `ServerErrorMiddleware` is handed the flag's *value* when the stack is
    # assembled, so debug must be pinned off and the stack rebuilt.
    was_debug = app.debug
    app.debug = False
    app.middleware_stack = app.build_middleware_stack()
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    try:
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as client:
            response = await client.get("/api/v1/players/some-puuid/league")
    finally:
        del app.dependency_overrides[get_player_service]
        del app.dependency_overrides[get_current_active_user]
        app.debug = was_debug
        app.middleware_stack = app.build_middleware_stack()

    assert response.status_code == 500
    assert response.json() == {"detail": SERVICE_ERROR_DETAIL}
