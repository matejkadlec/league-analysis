"""Logout must revoke even when the access token has already expired."""

import inspect
from collections.abc import Callable
from typing import cast
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.auth.cookies import (
    ACCESS_TOKEN_COOKIE_NAME,
    REFRESH_TOKEN_COOKIE_NAME,
)
from app.features.auth.router import logout
from app.features.auth.service import AuthService


def _undecorated[**P, R](endpoint: Callable[P, R]) -> Callable[P, R]:
    return cast(Callable[P, R], inspect.unwrap(endpoint))


def _request_with_cookies(bearer: str | None = None, **cookies: str) -> Request:
    header = "; ".join(f"{name}={value}" for name, value in cookies.items())
    raw = [(b"cookie", header.encode())] if header else []
    if bearer is not None:
        raw.append((b"authorization", f"Bearer {bearer}".encode()))
    return Request(
        {
            "type": "http",
            "method": "POST",
            "headers": raw,
            "client": ("127.0.0.1", 51234),
        }
    )


def _service(user_id: int | None) -> AuthService:
    service = AsyncMock(spec=AuthService)
    service.resolve_user_id_for_refresh_token.return_value = user_id
    return cast(AuthService, service)


@pytest.mark.asyncio
async def test_logout_revokes_using_only_the_refresh_cookie() -> None:
    """The access token expires in 30 minutes; the refresh token lasts 30 days.

    Logout used to depend on a valid access token, so any logout after a short
    idle period answered 401 and revoked nothing — leaving a usable 30-day
    credential in the browser of someone who had just been told they were
    signed out. Only the refresh cookie is present here, which is the ordinary
    case rather than an edge one.
    """
    service = _service(user_id=9)

    result = await _undecorated(logout)(
        request=_request_with_cookies(**{REFRESH_TOKEN_COOKIE_NAME: "refresh-token"}),
        response=Response(),
        auth_service=service,
    )

    revoke = cast(AsyncMock, service).revoke_all_refresh_tokens_for_user
    revoke.assert_awaited_once_with(9)
    assert result == {"message": "Successfully logged out"}


@pytest.mark.asyncio
async def test_logout_succeeds_and_clears_cookies_with_no_session_at_all() -> None:
    """Logout is idempotent: an unauthenticated call is answered, not refused.

    A caller can only ever revoke the session their own request carries, so
    there is nothing to protect by rejecting this — and rejecting it is what
    made the failure silent.
    """
    service = _service(user_id=None)
    response = Response()

    result = await _undecorated(logout)(
        request=_request_with_cookies(),
        response=response,
        auth_service=service,
    )

    assert result == {"message": "Successfully logged out"}
    cast(AsyncMock, service).revoke_all_refresh_tokens_for_user.assert_not_awaited()
    cleared = response.headers.getlist("set-cookie")
    for name in (ACCESS_TOKEN_COOKIE_NAME, REFRESH_TOKEN_COOKIE_NAME):
        assert any(header.startswith(f"{name}=") for header in cleared)


@pytest.mark.asyncio
async def test_logout_blacklists_the_access_token_when_one_is_present() -> None:
    service = _service(user_id=9)

    await _undecorated(logout)(
        request=_request_with_cookies(
            **{
                ACCESS_TOKEN_COOKIE_NAME: "access-token",
                REFRESH_TOKEN_COOKIE_NAME: "refresh-token",
            }
        ),
        response=Response(),
        auth_service=service,
    )

    cast(AsyncMock, service).revoke_access_token.assert_awaited_once_with(
        "access-token", reason="logout"
    )


@pytest.mark.asyncio
async def test_logout_accepts_a_bearer_token_when_no_cookies_are_present() -> None:
    """/login returns the pair in its body, so a client can hold only a Bearer.

    Reading identity from cookies alone made this a 200 that revoked nothing:
    the caller presents the strongest credential there is and still could not
    end its own session.
    """
    service = _service(user_id=None)

    def _resolve(_token: str) -> int:
        return 9

    cast(AsyncMock, service).resolve_user_id_for_access_token = _resolve

    await _undecorated(logout)(
        request=_request_with_cookies(bearer="access-token"),
        response=Response(),
        auth_service=service,
    )

    cast(AsyncMock, service).revoke_access_token.assert_awaited_once_with(
        "access-token", reason="logout"
    )
    cast(
        AsyncMock, service
    ).revoke_all_refresh_tokens_for_user.assert_awaited_once_with(9)


@pytest.mark.asyncio
async def test_a_revoked_refresh_token_names_nobody() -> None:
    """Otherwise a token already revoked can still revoke every other session.

    There is no DB in this suite, so the guard is read off the statement the
    service builds. Crude, but it fails if the filter is dropped, which is the
    only thing standing between a spent credential and mass revocation.
    """
    statements: list[object] = []

    class _RecordingDb:
        async def execute(self, statement: object) -> object:
            statements.append(statement)
            result = MagicMock()
            result.scalar_one_or_none.return_value = None
            return result

    service = AuthService(cast("AsyncSession", _RecordingDb()))

    assert await service.resolve_user_id_for_refresh_token("spent-token") is None

    sql = str(statements[0]).lower()
    assert "revoked_at is null" in sql
