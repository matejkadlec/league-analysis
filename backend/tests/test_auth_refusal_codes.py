"""A refusal has to name itself, because the browser cannot tell who answered.

The client ends a session only when a 401 or 403 from `/auth/refresh` carries
one of these codes (`token-manager.ts`). A status alone is not evidence: a
Cloudflare challenge in front of this API answers 403 with an HTML body and
the origin never sees the request, and a 403 from the API itself may be about
something other than the session -- an authorization gate added to a shared
dependency, say. Taking either for a refusal retracts the session hint while
the refresh token stays live, unrevoked, and unreachable to JavaScript.

So these codes are a contract with the frontend, and renaming one here would
silently stop every genuine sign-out from working. That failure is quiet in
the right direction -- visitors keep their session and get the retry surface
-- which is exactly why nothing else would catch it.
"""

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


@pytest.mark.asyncio
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


@pytest.mark.asyncio
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
