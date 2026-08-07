"""Authentication and route-authorization regression coverage."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.features.auth.dependencies import (
    get_current_active_user,
    get_current_admin_user,
)
from app.features.auth.router import login, refresh_access_token
from app.features.auth.schemas import (
    PasswordChangeRequest,
    RefreshTokenRequest,
    UserCreate,
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
    user = SimpleNamespace(is_active=False, is_admin=True)
    with pytest.raises(HTTPException) as error:
        await get_current_active_user(user)  # type: ignore[arg-type]
    assert error.value.status_code == 403
    assert error.value.detail == "Inactive user account"


@pytest.mark.asyncio
async def test_login_returns_a_dedicated_inactive_account_code() -> None:
    auth_service = SimpleNamespace(
        authenticate_user=AsyncMock(return_value=SimpleNamespace(is_active=False))
    )
    request = SimpleNamespace(
        client=SimpleNamespace(host="127.0.0.1"),
        headers={},
    )
    form_data = SimpleNamespace(username="player@example.com", password="Password-1!")

    with pytest.raises(HTTPException) as error:
        await login.__wrapped__(  # type: ignore[attr-defined]
            request=request,  # type: ignore[arg-type]
            form_data=form_data,  # type: ignore[arg-type]
            auth_service=auth_service,  # type: ignore[arg-type]
        )

    assert error.value.status_code == 403
    assert error.value.detail == {
        "code": "ACCOUNT_INACTIVE",
        "message": "This account is inactive. Contact an administrator to restore access.",
    }


@pytest.mark.asyncio
async def test_refresh_returns_the_same_inactive_account_code() -> None:
    user = SimpleNamespace(id=7, is_active=False)
    auth_service = SimpleNamespace(
        rotate_refresh_token=AsyncMock(return_value=(user, "", None, "", None)),
        revoke_all_refresh_tokens_for_user=AsyncMock(),
    )
    request = SimpleNamespace(client=SimpleNamespace(host="127.0.0.1"), headers={})

    with pytest.raises(HTTPException) as error:
        await refresh_access_token.__wrapped__(  # type: ignore[attr-defined]
            request=request,  # type: ignore[arg-type]
            refresh_request=RefreshTokenRequest(
                refresh_token="refresh-token-value-1234"
            ),
            auth_service=auth_service,  # type: ignore[arg-type]
        )

    assert error.value.status_code == 403
    assert error.value.detail["code"] == "ACCOUNT_INACTIVE"
    auth_service.revoke_all_refresh_tokens_for_user.assert_awaited_once_with(user.id)


@pytest.mark.asyncio
async def test_non_admin_user_is_forbidden_and_admin_is_allowed() -> None:
    regular_user = SimpleNamespace(is_active=True, is_admin=False)
    with pytest.raises(HTTPException) as error:
        await get_current_admin_user(regular_user)  # type: ignore[arg-type]
    assert error.value.status_code == 403
    assert error.value.detail == "Admin privileges required"

    admin_user = SimpleNamespace(is_active=True, is_admin=True)
    assert await get_current_admin_user(admin_user) is admin_user  # type: ignore[arg-type]
