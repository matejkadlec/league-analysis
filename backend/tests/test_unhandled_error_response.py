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
    # Pinned rather than inherited: `app.main` builds the app with
    # `debug=settings.debug`, and with it on Starlette's `ServerErrorMiddleware`
    # answers a plaintext traceback instead of the JSON body below -- so this
    # test failed on any dev machine whose root `.env` sets `DEBUG=true`, while
    # passing in CI.
    #
    # The rebuild is the point. `Starlette.debug` is a plain attribute, not a
    # property, and `ServerErrorMiddleware` is handed the flag's *value* when
    # the stack is assembled. The stack is assembled lazily on the first
    # request, so setting the attribute alone fixes this test when it runs by
    # itself and does nothing when any earlier test has already driven the app
    # -- which is the whole suite, and exactly the way a fix here would look
    # green locally and stay broken.
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
        app.debug = was_debug
        app.middleware_stack = app.build_middleware_stack()

    assert response.status_code == 500
    assert response.json() == {"detail": SERVICE_ERROR_DETAIL}
