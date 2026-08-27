"""Logout must revoke even when the access token has already expired."""

from datetime import UTC, datetime, timedelta
from typing import Any, cast
from unittest.mock import AsyncMock, MagicMock

import jwt
import pytest
from fastapi import Request, Response
from sqlalchemy import Select
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_global_settings
from app.core.schemas import MessageResponse
from app.features.auth.cookies import (
    ACCESS_TOKEN_COOKIE_NAME,
    AUTH_STATE_COOKIE_NAME,
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


async def test_logout_revokes_using_only_the_refresh_cookie() -> None:
    """The access token expires in 30 minutes; the refresh token lasts 30 days.

    Depending on a valid access token means a logout after a short idle period
    answers 401 and revokes nothing, leaving a usable 30-day credential behind.
    Only the refresh cookie is present here, which is the ordinary case.
    """
    service = _service(user_id=9)

    result = await logout(
        request=_request_with_cookies(**{REFRESH_TOKEN_COOKIE_NAME: "refresh-token"}),
        response=Response(),
        auth_service=service,
    )

    revoke = cast(AsyncMock, service).revoke_all_refresh_tokens_for_user
    revoke.assert_awaited_once_with(9)
    assert result == MessageResponse(message="Successfully logged out")


async def test_logout_succeeds_and_clears_cookies_with_no_session_at_all() -> None:
    """Logout is idempotent: an unauthenticated call is answered, not refused.

    A caller can only ever revoke the session their own request carries, so
    there is nothing to protect by rejecting this. The request here carries the
    hint alone; no cookie at all lives in `test_auth_logout_route.py`.
    """
    service = _service(user_id=None)
    response = Response()

    result = await logout(
        request=_request_with_cookies(**{AUTH_STATE_COOKIE_NAME: "1"}),
        response=response,
        auth_service=service,
    )

    assert result == MessageResponse(message="Successfully logged out")
    cast(AsyncMock, service).revoke_all_refresh_tokens_for_user.assert_not_awaited()
    cleared = response.headers.getlist("set-cookie")
    # The session hint belongs in this list too: `proxy.ts` routes on it, so a
    # logout that leaves it standing sends the visitor back into a signed-in
    # shell the API will refuse.
    for name in (
        ACCESS_TOKEN_COOKIE_NAME,
        REFRESH_TOKEN_COOKIE_NAME,
        AUTH_STATE_COOKIE_NAME,
    ):
        assert any(header.startswith(f"{name}=") for header in cleared)


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


async def test_refresh_tokens_are_revoked_before_the_access_token() -> None:
    """Each revocation commits separately, so the order is the failure mode.

    If the second call fails, whatever the first did stands. Losing the
    30-minute credential and keeping the 30-day one is survivable; the other
    way round leaves a live refresh cookie in a browser told it is signed out.
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


async def test_a_bearer_token_is_spent_only_on_itself() -> None:
    """An access token blacklists itself and signs nobody out everywhere.

    Letting a Bearer name its owner is a session-denial primitive: the route is
    unauthenticated, revoking by user ends every session they own, and an access
    token rides on every request and lands in logs and crash dumps.
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


async def test_a_refresh_token_names_the_user_it_belongs_to() -> None:
    """Binds the lookup to the hash and to `user_id` specifically.

    A bind value never appears in rendered SQL, so asserting on columns alone
    leaves two breakages green: matching the raw token instead of its hash, and
    reading `.id` instead of `.user_id` off the row.
    """
    row = MagicMock()
    row.id = 4321
    row.user_id = 9
    row.revoked_at = None
    db = _RecordingDb(row)
    service = AuthService(cast("AsyncSession", db))

    assert await service.resolve_user_id_for_refresh_token("raw-token") == 9

    bound = db.statements[0].compile().params
    assert AuthService._hash_refresh_token("raw-token") in bound.values()
    assert "raw-token" not in bound.values()


def _live_access_token() -> str:
    settings = get_global_settings()
    return jwt.encode(
        {
            "user_id": 9,
            "typ": "access",
            "jti": "t",
            "exp": int((datetime.now(UTC) + timedelta(minutes=5)).timestamp()),
        },
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )


async def test_a_database_fault_during_revocation_is_not_swallowed() -> None:
    """Only the duplicate-key conflict is tolerated, not every failure.

    `ON CONFLICT DO NOTHING` swallows exactly the duplicate `token_id` and
    nothing else. Widening it would turn a real DB fault into a logout that
    reports success with the token still honoured.
    """

    class _Faulty:
        async def execute(self, _statement: object) -> object:
            return MagicMock()

        async def commit(self) -> None:
            raise OperationalError("insert", (), Exception("connection lost"))

    service = AuthService(cast("AsyncSession", _Faulty()))

    with pytest.raises(OperationalError):
        await service.revoke_access_token(_live_access_token(), reason="logout")


async def test_the_blacklist_row_names_the_token_it_revokes() -> None:
    """Nothing else in the suite looks at what is actually inserted.

    The other fakes ignore the statement handed to `execute()`, so writing the
    wrong `token_id` leaves every test green while a spent token keeps working.
    The same capture pins the conflict clause a second logout depends on.
    """

    class _CapturingDb:
        def __init__(self) -> None:
            self.statements: list[Any] = []

        async def execute(self, statement: Any) -> object:
            self.statements.append(statement)
            return MagicMock()

        async def commit(self) -> None:
            return None

    db = _CapturingDb()
    service = AuthService(cast("AsyncSession", db))

    await service.revoke_access_token(_live_access_token(), reason="logout")
    await service.revoke_access_token(_live_access_token(), reason="logout")

    assert len(db.statements) == 2
    compiled = db.statements[0].compile(dialect=postgresql.dialect())
    assert compiled.params["token_id"] == "t"
    assert compiled.params["user_id"] == 9
    assert compiled.params["reason"] == "logout"
    assert compiled.params["expires_at"] > datetime.now(UTC)
    assert "ON CONFLICT (token_id) DO NOTHING" in str(compiled)
