"""A refusal has to name itself, because the browser cannot tell who answered.

The client ends a session only when a 401 or 403 from `/auth/refresh` carries
one of these codes (`token-manager.ts`); a status alone is not evidence. These
codes are a contract with the frontend, so renaming one breaks every sign-out.
"""

import re
from datetime import UTC, datetime, timedelta
from typing import Any, cast
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException, Request, Response

from app.features.auth.cookies import REFRESH_TOKEN_COOKIE_NAME
from app.features.auth.router import refresh_access_token
from app.features.auth.service import AuthService

SESSION_ENDING_CODES = {"INVALID_REFRESH_TOKEN", "ACCOUNT_INACTIVE"}


def _request() -> Request:
    cookie = f"{REFRESH_TOKEN_COOKIE_NAME}=refresh-token".encode()
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/v1/auth/refresh",
            "headers": [(b"cookie", cookie)],
            "query_string": b"",
            "client": ("127.0.0.1", 1234),
        }
    )


def _service(rotated: Any) -> AuthService:
    service = MagicMock(spec=AuthService)
    service.rotate_refresh_token = AsyncMock(return_value=rotated)
    service.revoke_all_refresh_tokens_for_user = AsyncMock()
    service.cleanup_expired_token_state = AsyncMock()
    return cast(AuthService, service)


async def test_a_rejected_refresh_token_names_itself() -> None:
    with pytest.raises(HTTPException) as raised:
        await refresh_access_token(
            request=_request(),
            response=Response(),
            refresh_request=None,
            auth_service=_service(None),
        )

    assert raised.value.status_code == 401
    detail = cast(dict[str, str], raised.value.detail)
    assert detail["code"] == "INVALID_REFRESH_TOKEN"
    assert detail["code"] in SESSION_ENDING_CODES


async def test_a_deactivated_account_names_itself_and_revokes_first() -> None:
    user = MagicMock()
    user.id = 7
    user.is_active = False
    service = _service((user, "access", None, "refresh", None))

    with pytest.raises(HTTPException) as raised:
        await refresh_access_token(
            request=_request(),
            response=Response(),
            refresh_request=None,
            auth_service=service,
        )

    assert raised.value.status_code == 403
    detail = cast(dict[str, str], raised.value.detail)
    assert detail["code"] == "ACCOUNT_INACTIVE"
    assert detail["code"] in SESSION_ENDING_CODES
    # The client tears down on this one, so the server must already have.
    cast(
        AsyncMock, service.revoke_all_refresh_tokens_for_user
    ).assert_awaited_once_with(7)


async def test_the_refusal_survives_the_app_as_json_the_browser_can_read() -> None:
    """The shape on the wire, after every middleware and exception handler.

    The tests above pin what the route raises; this pins what the browser
    actually receives, because the client reads `detail.code` out of a JSON
    body. An envelope added anywhere in the stack silently breaks sign-out.
    """
    import httpx

    from app.main import app

    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as client:
        response = await client.post("/api/v1/auth/refresh", json={})

    assert response.status_code == 401
    # The same rule the client applies (`namesTheEndOfTheSession`): any JSON
    # media type, but a body the browser cannot read as JSON, or one without
    # `detail.code`, silently ends every genuine sign-out.
    assert re.match(r"^application/([\w.+-]+\+)?json", response.headers["content-type"])
    assert response.json()["detail"]["code"] == "INVALID_REFRESH_TOKEN"


async def test_a_database_fault_is_not_laundered_into_a_refusal() -> None:
    """An outage must not come back as "your session is over".

    `None` from `rotate_refresh_token` becomes 401 INVALID_REFRESH_TOKEN, and
    the browser ends the session on that name, so catching a database error
    under it signs every visitor out for the length of the blip.
    """
    from sqlalchemy.exc import DBAPIError

    from app.features.auth.service import AuthService as RealAuthService

    fault = DBAPIError("SELECT", {}, Exception("connection terminated"))

    # 1. The lookup that finds the token record, after the family lock.
    db = MagicMock()
    db.scalar = AsyncMock(return_value=5)
    db.execute = AsyncMock(side_effect=[MagicMock(), fault])
    db.commit = AsyncMock()
    with pytest.raises(DBAPIError):
        await RealAuthService(db).rotate_refresh_token(raw_refresh_token="x")
    cast(AsyncMock, db.commit).assert_not_awaited()

    # 2. The user lookup, driven through `rotate_refresh_token` rather than
    #    called directly -- the call site is what matters. Swallowing there
    #    lands in the unknown-user branch, which revokes the still-valid row.
    now = datetime.now(UTC)
    record = MagicMock()
    record.revoked_at = None
    record.expires_at = now + timedelta(days=30)
    record.user_id = 5
    lookup = MagicMock()
    lookup.scalar_one_or_none = MagicMock(return_value=record)
    db = MagicMock()
    db.scalar = AsyncMock(return_value=5)
    db.execute = AsyncMock(side_effect=[MagicMock(), lookup, fault])
    db.commit = AsyncMock()
    with pytest.raises(DBAPIError):
        await RealAuthService(db).rotate_refresh_token(raw_refresh_token="x")
    assert record.revoked_at is None
    cast(AsyncMock, db.commit).assert_not_awaited()

    # 3. The revocation the reuse branch performs before refusing, again
    #    through the real path: a reused token is a refusal, but only once the
    #    family really has been revoked.
    reused = MagicMock()
    reused.revoked_at = now
    reused.user_id = 5
    reused_lookup = MagicMock()
    reused_lookup.scalar_one_or_none = MagicMock(return_value=reused)
    db = MagicMock()
    db.scalar = AsyncMock(return_value=5)
    db.execute = AsyncMock(side_effect=[MagicMock(), reused_lookup, fault])
    db.commit = AsyncMock()
    with pytest.raises(DBAPIError):
        await RealAuthService(db).rotate_refresh_token(raw_refresh_token="x")

    # 4. The commit that stores the rotated token.
    record = MagicMock()
    record.revoked_at = None
    record.expires_at = now + timedelta(days=30)
    record.user_id = 5
    user = MagicMock()
    user.id = 5
    db = MagicMock()
    db.scalar = AsyncMock(return_value=5)
    lookup = MagicMock()
    lookup.scalar_one_or_none = MagicMock(return_value=record)
    db.execute = AsyncMock(return_value=lookup)
    db.add = MagicMock()
    db.commit = AsyncMock(side_effect=fault)
    service = RealAuthService(db)
    service.get_user_by_id = AsyncMock(return_value=user)
    with pytest.raises(DBAPIError):
        await service.rotate_refresh_token(raw_refresh_token="x")


async def test_a_fault_reaching_the_route_is_not_answered_as_a_refusal() -> None:
    """The same laundering, one frame up, where the refusal is actually minted.

    The test above drives the database faults through `rotate_refresh_token`;
    this drives one into the `await` in the route, where wrapping the call
    mints a 401 indistinguishable from a real refusal. A 500 is honest.
    """
    from sqlalchemy.exc import DBAPIError

    service = _service(None)
    cast(MagicMock, service).rotate_refresh_token = AsyncMock(
        side_effect=DBAPIError("SELECT", {}, Exception("connection terminated"))
    )

    with pytest.raises(DBAPIError):
        await refresh_access_token(
            request=_request(),
            response=Response(),
            refresh_request=None,
            auth_service=service,
        )
