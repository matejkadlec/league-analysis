"""Logout asserted through real FastAPI routing, not by calling the function.

Every other logout test unwraps the endpoint and awaits it directly, skipping
decorators and dependencies. Re-adding `@rate_limit` or an auth `Depends` would
leave that file green while sign-out broke — so these go through the router.
"""

from collections.abc import AsyncIterator
from typing import cast
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI

from app.features.auth.cookies import (
    ACCESS_TOKEN_COOKIE_NAME,
    AUTH_STATE_COOKIE_NAME,
    REFRESH_TOKEN_COOKIE_NAME,
)
from app.features.auth.dependencies import get_auth_service
from app.features.auth.router import router
from app.features.auth.service import AuthService


async def _post(client: httpx.AsyncClient, cookie: str | None = None) -> httpx.Response:
    """POST /auth/logout, optionally carrying one raw cookie header."""
    headers = {"Cookie": cookie} if cookie else None
    return await client.post("/auth/logout", headers=headers)


@pytest.fixture
def service() -> AuthService:
    stub = AsyncMock(spec=AuthService)
    stub.resolve_user_id_for_refresh_token.return_value = None
    return cast(AuthService, stub)


@pytest.fixture
async def client(service: AuthService) -> AsyncIterator[httpx.AsyncClient]:
    # `ASGITransport`, not starlette's TestClient: the latter is annotated
    # against httpx2, which this environment does not install, and it warns at
    # import time in a suite that treats warnings as errors.
    app = FastAPI()
    app.include_router(router)

    async def _service() -> AuthService:
        return service

    app.dependency_overrides[get_auth_service] = _service
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as test_client:
        yield test_client


async def test_logout_needs_no_credentials_to_reach_the_handler(
    client: httpx.AsyncClient,
) -> None:
    """No `Depends(get_current_user)` may creep back onto this route.

    Requiring a valid access token is exactly how logout used to answer 401
    after 30 minutes idle, revoking nothing while the UI said "signed out".
    """
    response = await _post(client)

    assert response.status_code == 200
    assert response.json() == {"message": "Successfully logged out"}


async def test_repeated_logouts_are_never_refused(client: httpx.AsyncClient) -> None:
    """Pins the absence of a rate limit on this route.

    The limiter keys on `get_remote_address`, and behind the Next.js rewrite
    with `--no-proxy-headers` every user in production shares one bucket. A
    limit here is globally deniable: one client can spend everyone's quota.
    """
    # More iterations than any per-minute limit anyone would plausibly set
    # here; the existing limits in this router run 3-20/minute.
    for _ in range(80):
        assert (await _post(client)).status_code == 200


async def test_anonymous_logout_does_not_run_the_table_wide_cleanup(
    client: httpx.AsyncClient, service: AuthService
) -> None:
    """The route is unauthenticated, so this must not be reachable by anyone.

    `cleanup_expired_token_state` issues two full-table DELETEs and a COMMIT.
    Running it for credential-less callers lets anonymous requests drive write
    transactions at request rate.
    """
    assert (await _post(client)).status_code == 200

    cast(AsyncMock, service).cleanup_expired_token_state.assert_not_awaited()


async def test_logout_with_a_refresh_cookie_still_cleans_up(
    client: httpx.AsyncClient, service: AuthService
) -> None:
    cast(AsyncMock, service).resolve_user_id_for_refresh_token.return_value = 9

    response = await _post(client, cookie=f"{REFRESH_TOKEN_COOKIE_NAME}=refresh-token")

    assert response.status_code == 200
    cast(AsyncMock, service).cleanup_expired_token_state.assert_awaited()


async def test_a_credential_less_logout_writes_no_deletion_cookies(
    client: httpx.AsyncClient,
) -> None:
    """Because anyone's website can make this request.

    The route is unauthenticated, so a top-level form POST from any page
    reaches it. SameSite=Lax keeps the cookies off that request, so it revokes
    nothing, but deletion Set-Cookies would still sign the visitor out.
    """
    assert (await _post(client)).headers.get_list("set-cookie") == []


async def test_a_real_sign_out_still_clears_every_cookie(
    client: httpx.AsyncClient, service: AuthService
) -> None:
    """The other direction, and the reason the guard reads the request.

    Narrowing it further -- to a valid refresh token, say -- would leave the
    cookies in place for anyone whose token had expired or been revoked, a
    signed-out visitor still holding a hint that `proxy.ts` admits.
    """
    cast(AsyncMock, service).resolve_user_id_for_refresh_token.return_value = None

    response = await _post(client, cookie=f"{AUTH_STATE_COOKIE_NAME}=1")

    written = {
        header.split("=", 1)[0] for header in response.headers.get_list("set-cookie")
    }
    assert written == {
        ACCESS_TOKEN_COOKIE_NAME,
        REFRESH_TOKEN_COOKIE_NAME,
        AUTH_STATE_COOKIE_NAME,
    }
