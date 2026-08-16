"""Authentication and route-authorization regression coverage."""

import inspect
from collections.abc import Callable
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException, Request
from fastapi.security import OAuth2PasswordRequestForm

from app.features.auth.dependencies import (
    get_current_active_user,
    get_current_admin_user,
)
from app.features.auth.models import User
from app.features.auth.router import login, refresh_access_token
from app.features.auth.schemas import (
    PasswordChangeRequest,
    RefreshTokenRequest,
    UserCreate,
)
from app.features.auth.service import AuthService


def _undecorated[**P, R](endpoint: Callable[P, R]) -> Callable[P, R]:
    """Return the endpoint that ``rate_limit`` wrapped.

    The decorator preserves the endpoint's signature for callers, but the
    wrapper it installs wants limiter state and a fully formed ASGI request
    that these unit tests have no reason to build. ``functools.wraps`` leaves
    the original coroutine function on ``__wrapped__``, which no ``Callable``
    type describes, so the unwrapping is dynamic and the signature is restated
    here — it is the one the decorator is contracted to keep.
    """
    return cast(Callable[P, R], inspect.unwrap(endpoint))


def _loopback_request() -> Request:
    """A request carrying the loopback client and empty headers routes read."""
    return Request(
        {
            "type": "http",
            "method": "POST",
            "headers": [],
            "client": ("127.0.0.1", 51234),
        }
    )


@pytest.mark.parametrize(
    "password",
    [
        "missing-uppercase-1!",
        "MISSING-LOWERCASE-1!",
        "MissingNumber!",
        "MissingSpecial1",
    ],
)
def test_user_create_rejects_weak_passwords(password: str) -> None:
    with pytest.raises(ValueError):
        UserCreate(email="player@example.com", display_name="Player", password=password)


def test_password_change_requires_matching_strong_passwords() -> None:
    request = PasswordChangeRequest(
        current_password="Old-password-1!",
        new_password="New-password-2!",
        repeat_password="New-password-2!",
    )
    assert request.new_password == request.repeat_password

    with pytest.raises(ValueError, match="Passwords do not match"):
        PasswordChangeRequest(
            current_password="Old-password-1!",
            new_password="New-password-2!",
            repeat_password="Different-password-3!",
        )


@pytest.mark.asyncio
async def test_inactive_user_is_forbidden() -> None:
    user = User(is_active=False, is_admin=True)
    with pytest.raises(HTTPException) as error:
        await get_current_active_user(user)
    assert error.value.status_code == 403
    assert error.value.detail == "Inactive user account"


@pytest.mark.asyncio
async def test_login_returns_a_dedicated_inactive_account_code() -> None:
    auth_service = SimpleNamespace(
        authenticate_user=AsyncMock(return_value=SimpleNamespace(is_active=False))
    )
    form_data = OAuth2PasswordRequestForm(
        username="player@example.com", password="Password-1!"
    )

    with pytest.raises(HTTPException) as error:
        await _undecorated(login)(
            request=_loopback_request(),
            form_data=form_data,
            auth_service=cast(AuthService, auth_service),
        )

    assert error.value.status_code == 403
    assert error.value.detail == {
        "code": "ACCOUNT_INACTIVE",
        "message": "This account is inactive. Contact an administrator to restore access.",
    }


@pytest.mark.asyncio
async def test_refresh_returns_the_same_inactive_account_code() -> None:
    user = SimpleNamespace(id=7, is_active=False)
    revoke_all_refresh_tokens_for_user = AsyncMock()
    auth_service = SimpleNamespace(
        rotate_refresh_token=AsyncMock(return_value=(user, "", None, "", None)),
        revoke_all_refresh_tokens_for_user=revoke_all_refresh_tokens_for_user,
    )

    with pytest.raises(HTTPException) as error:
        await _undecorated(refresh_access_token)(
            request=_loopback_request(),
            refresh_request=RefreshTokenRequest(
                refresh_token="refresh-token-value-1234"
            ),
            auth_service=cast(AuthService, auth_service),
        )

    assert error.value.status_code == 403
    # Starlette annotates ``HTTPException.detail`` as ``str``; FastAPI passes
    # whatever the route raised, and this route raises the structured mapping
    # the client contract is written against.
    detail = cast(dict[str, str], error.value.detail)
    assert detail["code"] == "ACCOUNT_INACTIVE"
    revoke_all_refresh_tokens_for_user.assert_awaited_once_with(user.id)


@pytest.mark.asyncio
async def test_non_admin_user_is_forbidden_and_admin_is_allowed() -> None:
    regular_user = User(is_active=True, is_admin=False)
    with pytest.raises(HTTPException) as error:
        await get_current_admin_user(regular_user)
    assert error.value.status_code == 403
    assert error.value.detail == "Admin privileges required"

    admin_user = User(is_active=True, is_admin=True)
    assert await get_current_admin_user(admin_user) is admin_user
