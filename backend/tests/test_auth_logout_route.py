"""Logout asserted through real FastAPI routing, not by calling the function.

Every other logout test unwraps the endpoint and awaits it directly, which
skips decorators and dependencies entirely. Re-adding `@rate_limit` or an
auth `Depends` to this route would leave that whole file green while sign-out
broke in the browser — so these go through the router.
"""

import warnings
from collections.abc import Iterator
from typing import cast
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI
from starlette.exceptions import StarletteDeprecationWarning

from app.features.auth.cookies import (
    ACCESS_TOKEN_COOKIE_NAME,
    AUTH_STATE_COOKIE_NAME,
    REFRESH_TOKEN_COOKIE_NAME,
)
from app.features.auth.router import router
from app.features.auth.service import AuthService, get_auth_service

with warnings.catch_warnings():
    # The suite treats warnings as errors, and starlette's TestClient still
    # warns at import time while it runs on httpx instead of httpx2.
    warnings.simplefilter("ignore", StarletteDeprecationWarning)
    from starlette.testclient import TestClient


def _post(client: TestClient, cookie: str | None = None) -> httpx.Response:
    """Issue the POST typed as the httpx response it really is.

    starlette's testclient annotates its methods against httpx2, which this
    environment does not install, so the unresolvable stubs are ignored here
    exactly once instead of at every call site.
    """
    headers = {"Cookie": cookie} if cookie else None
    response = client.post("/logout", headers=headers)  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
    return cast(httpx.Response, response)


@pytest.fixture
def service() -> AuthService:
    stub = AsyncMock(spec=AuthService)
    stub.resolve_user_id_for_refresh_token.return_value = None
    return cast(AuthService, stub)


@pytest.fixture
def client(service: AuthService) -> Iterator[TestClient]:
    app = FastAPI()
    app.include_router(router)

    async def _service() -> AuthService:
        return service

    app.dependency_overrides[get_auth_service] = _service
    with TestClient(app) as test_client:
        yield test_client


def test_logout_needs_no_credentials_to_reach_the_handler(
    client: TestClient,
) -> None:
    """No `Depends(get_current_user)` may creep back onto this route.

    Requiring a valid access token is exactly how logout used to answer 401
    after 30 minutes idle, revoking nothing while the UI said "signed out".
    """
    response = _post(client)

    assert response.status_code == 200
    assert response.json() == {"message": "Successfully logged out"}


def test_repeated_logouts_are_never_refused(client: TestClient) -> None:
    """Pins the absence of a rate limit on this route.

    The limiter keys on `get_remote_address`, and behind the Next.js rewrite
    with `--no-proxy-headers` every user in production shares one bucket. A
    limit here is therefore globally deniable: one client can spend the quota
    and nobody else can sign out.
    """
    # More iterations than any per-minute limit anyone would plausibly set
    # here; the existing limits in this router run 3-20/minute.
    for _ in range(80):
        assert _post(client).status_code == 200


def test_anonymous_logout_does_not_run_the_table_wide_cleanup(
    client: TestClient, service: AuthService
) -> None:
    """The route is unauthenticated, so this must not be reachable by anyone.

    `cleanup_expired_token_state` issues two full-table DELETEs and a COMMIT.
    Running it for credential-less callers lets anonymous requests drive write
    transactions at request rate.
    """
    assert _post(client).status_code == 200

    cast(AsyncMock, service).cleanup_expired_token_state.assert_not_awaited()


def test_logout_with_a_refresh_cookie_still_cleans_up(
    client: TestClient, service: AuthService
) -> None:
    cast(AsyncMock, service).resolve_user_id_for_refresh_token.return_value = 9

    response = _post(client, cookie=f"{REFRESH_TOKEN_COOKIE_NAME}=refresh-token")

    assert response.status_code == 200
    cast(AsyncMock, service).cleanup_expired_token_state.assert_awaited()


def test_a_credential_less_logout_writes_no_deletion_cookies(
    client: TestClient,
) -> None:
    """Because anyone's website can make this request.

    Dropping the auth dependency was right -- it is what made sign-out work
    after 30 minutes idle -- but it also opened this route to a top-level form
    POST from any page on the internet. SameSite=Lax keeps the cookies off
    that request, so it revokes nothing; the response still arrives in a
    first-party context, so three deletion Set-Cookies would be applied.
    The visitor is signed out on someone else's say-so, their refresh row live
    and unrevoked for the rest of its 30 days with no browser holding it: the
    stranded session this branch exists to remove, reached from outside.

    A caller carrying no cookie has nothing to clear, so refusing to write
    them costs nothing.
    """
    assert _post(client).headers.get_list("set-cookie") == []


def test_a_real_sign_out_still_clears_every_cookie(
    client: TestClient, service: AuthService
) -> None:
    """The other direction, and the reason the guard reads the request.

    Narrowing it further -- to a valid refresh token, say -- would leave the
    cookies in place for anyone whose token had already expired or been
    revoked elsewhere, which is a signed-out visitor still holding a hint that
    `proxy.ts` admits.
    """
    cast(AsyncMock, service).resolve_user_id_for_refresh_token.return_value = None

    response = _post(client, cookie=f"{AUTH_STATE_COOKIE_NAME}=1")

    written = {
        header.split("=", 1)[0] for header in response.headers.get_list("set-cookie")
    }
    assert written == {
        ACCESS_TOKEN_COOKIE_NAME,
        REFRESH_TOKEN_COOKIE_NAME,
        AUTH_STATE_COOKIE_NAME,
    }
