"""Logout must revoke even when the access token has already expired."""

from typing import Any, cast
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import Request, Response
from sqlalchemy import Select
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.auth.cookies import (
    ACCESS_TOKEN_COOKIE_NAME,
    REFRESH_TOKEN_COOKIE_NAME,
)
from app.features.auth.router import logout
from app.features.auth.service import AuthService


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

    result = await logout(
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

    result = await logout(
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

    await logout(
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
async def test_the_refresh_cookie_decides_who_is_logged_out() -> None:
    """A presented access token must not name anyone, not even a bystander.

    This route is unauthenticated, so both credentials arrive unverified from
    the same request. The bearer here belongs to someone else entirely; only
    the refresh cookie's owner may be signed out.
    """
    service = _service(user_id=7)

    await logout(
        request=_request_with_cookies(
            bearer="someone-elses-access-token",
            **{REFRESH_TOKEN_COOKIE_NAME: "refresh-token"},
        ),
        response=Response(),
        auth_service=service,
    )

    cast(
        AsyncMock, service
    ).revoke_all_refresh_tokens_for_user.assert_awaited_once_with(7)


@pytest.mark.asyncio
async def test_refresh_tokens_are_revoked_before_the_access_token() -> None:
    """Each revocation commits separately, so the order is the failure mode.

    If the second call fails -- dropped connection, deadlock, statement
    timeout -- whatever the first did stands. Losing the 30-minute credential
    and keeping the 30-day one is survivable, because it dies on its own. The
    other way round leaves a live 30-day refresh cookie in a browser that has
    already been told it is signed out, which is exactly what this branch
    exists to stop.
    """
    service = _service(user_id=9)
    order: list[str] = []

    def _record_refresh(*_args: object, **_kwargs: object) -> None:
        order.append("refresh")

    def _record_access(*_args: object, **_kwargs: object) -> None:
        order.append("access")

    cast(
        AsyncMock, service
    ).revoke_all_refresh_tokens_for_user.side_effect = _record_refresh
    cast(AsyncMock, service).revoke_access_token.side_effect = _record_access

    await logout(
        request=_request_with_cookies(
            **{
                ACCESS_TOKEN_COOKIE_NAME: "access-token",
                REFRESH_TOKEN_COOKIE_NAME: "refresh-token",
            }
        ),
        response=Response(),
        auth_service=service,
    )

    assert order == ["refresh", "access"]


@pytest.mark.asyncio
async def test_a_bearer_token_is_spent_only_on_itself() -> None:
    """An access token blacklists itself and signs nobody out everywhere.

    It used to name its owner, so that a client holding only the pair
    `/login` returned could end its own session. That fallback was a
    session-denial primitive: the route is unauthenticated, naming a user
    revokes every session they own, an access token rides on every request
    and lands in logs and crash dumps, and no age bound resolves it -- short
    enough to be safe is too short to serve the idle client it existed for.
    Nothing holds only a Bearer here; the browser has the refresh cookie,
    which wins anyway. So the capability went rather than the window shrank.
    """
    service = _service(user_id=None)

    await logout(
        request=_request_with_cookies(bearer="access-token"),
        response=Response(),
        auth_service=service,
    )

    cast(AsyncMock, service).revoke_access_token.assert_awaited_once_with(
        "access-token", reason="logout"
    )
    cast(AsyncMock, service).revoke_all_refresh_tokens_for_user.assert_not_awaited()


class _RecordingDb:
    """Captures the statement and answers with the row it was given."""

    def __init__(self, row: object | None) -> None:
        self.statements: list[Select[Any]] = []
        self._row = row

    async def execute(self, statement: Select[Any]) -> object:
        self.statements.append(statement)
        result = MagicMock()
        result.scalar_one_or_none.return_value = self._row
        return result


@pytest.mark.asyncio
async def test_a_refresh_token_names_the_user_it_belongs_to() -> None:
    """Binds the lookup to the hash and to `user_id` specifically.

    Asserting only that the statement mentions the right columns leaves two
    one-line breakages green, because a bind value never appears in rendered
    SQL: matching on the raw token instead of its hash (logout then resolves
    nobody and revokes nothing -- the 30-day-credential bug this branch
    exists to close), and reading `.id` instead of `.user_id` off the row
    (logout then revokes some other user's every session).
    """
    row = MagicMock()
    row.id = 4321
    row.user_id = 9
    db = _RecordingDb(row)
    service = AuthService(cast("AsyncSession", db))

    assert await service.resolve_user_id_for_refresh_token("raw-token") == 9

    bound = db.statements[0].compile().params
    assert AuthService._hash_refresh_token("raw-token") in bound.values()
    assert "raw-token" not in bound.values()


@pytest.mark.asyncio
async def test_a_revoked_refresh_token_names_nobody() -> None:
    """Otherwise a token already revoked can still revoke every other session.

    There is no DB in this suite, so the guard is read off the statement the
    service builds. Crude, but it fails if the filter is dropped, which is the
    only thing standing between a spent credential and mass revocation.
    """
    db = _RecordingDb(None)
    service = AuthService(cast("AsyncSession", db))

    assert await service.resolve_user_id_for_refresh_token("spent-token") is None

    sql = str(db.statements[0]).lower()
    assert "revoked_at is null" in sql
    # Without this the filter assertion alone passes even if the lookup stops
    # matching on the token at all, which would hand every caller the first
    # unrevoked session in the table.
    assert "token_hash =" in sql
