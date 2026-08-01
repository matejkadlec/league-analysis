"""Authentication and route-authorization regression coverage."""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.features.auth.dependencies import (
    get_current_active_user,
    get_current_admin_user,
)
from app.features.auth.schemas import PasswordChangeRequest, UserCreate


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
async def test_non_admin_user_is_forbidden_and_admin_is_allowed() -> None:
    regular_user = SimpleNamespace(is_active=True, is_admin=False)
    with pytest.raises(HTTPException) as error:
        await get_current_admin_user(regular_user)  # type: ignore[arg-type]
    assert error.value.status_code == 403
    assert error.value.detail == "Admin privileges required"

    admin_user = SimpleNamespace(is_active=True, is_admin=True)
    assert await get_current_admin_user(admin_user) is admin_user  # type: ignore[arg-type]
