"""Authentication and route-authorization regression coverage."""

from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException, Response
from fastapi.security import OAuth2PasswordRequestForm

from app.features.auth.dependencies import (
    get_current_active_user,
    get_current_admin_user,
)
from app.features.auth.models import User
from app.features.auth.router import login, refresh_access_token
from app.features.auth.schemas import (
    JoinUsContactRequest,
    JoinUsSubject,
    PasswordChangeRequest,
    RefreshTokenRequest,
    UserCreate,
    validate_password_strength,
)
from app.features.auth.service import AuthService
from route_helpers import loopback_request, undecorated


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


def test_password_policy_owns_the_length_rule_itself() -> None:
    # Both schema call sites hide the length rule behind Field(min_length=8);
    # the named policy function must still enforce it for any caller that
    # doesn't.
    with pytest.raises(ValueError, match="at least 8 characters"):
        validate_password_strength("Sh0rt-!")


def test_join_us_body_is_trimmed_and_whitespace_only_is_rejected() -> None:
    # Field(min_length=1) sees the raw value, so "   " passes it; only the
    # validator stands between a whitespace-only submission and the inbox.
    request = JoinUsContactRequest(subject=JoinUsSubject.OTHER, body="  hello  ")
    assert request.body == "hello"

    with pytest.raises(ValueError, match="cannot be empty"):
        JoinUsContactRequest(subject=JoinUsSubject.OTHER, body="   ")


@pytest.mark.parametrize(
    "weak",
    [
        "missing-uppercase-1!",
        "MISSING-LOWERCASE-1!",
        "MissingNumber!",
        "MissingSpecial1",
        "Sh0rt!",
    ],
)
def test_password_change_holds_the_new_password_to_the_strength_policy(
    weak: str,
) -> None:
    """Registration's policy applies to a change too, and nothing said so.

    Every password this file fed the model was already strong, so dropping
    the `validate_password_strength` call from `PasswordChangeRequest` left
    the suite green and accepted any eight characters.
    """
    with pytest.raises(ValueError):
        PasswordChangeRequest(
            current_password="Old-password-1!",
            new_password=weak,
            repeat_password=weak,
        )


def test_password_change_requires_both_copies_to_match() -> None:
    with pytest.raises(ValueError, match="Passwords do not match"):
        PasswordChangeRequest(
            current_password="Old-password-1!",
            new_password="New-password-2!",
            repeat_password="Different-password-3!",
        )


async def test_inactive_user_is_forbidden() -> None:
    user = User(is_active=False, is_admin=True)
    with pytest.raises(HTTPException) as error:
        await get_current_active_user(user)
    assert error.value.status_code == 403
    assert cast(dict[str, str], error.value.detail)["code"] == "ACCOUNT_INACTIVE"


async def test_login_returns_a_dedicated_inactive_account_code() -> None:
    auth_service = SimpleNamespace(
        authenticate_user=AsyncMock(
            return_value=SimpleNamespace(
                id=7, is_active=False, email="player@example.com"
            )
        )
    )
    form_data = OAuth2PasswordRequestForm(
        username="player@example.com", password="Password-1!"
    )

    with pytest.raises(HTTPException) as error:
        await undecorated(login)(
            request=loopback_request(),
            response=Response(),
            form_data=form_data,
            auth_service=cast(AuthService, auth_service),
        )

    assert error.value.status_code == 403
    assert error.value.detail == {
        "code": "ACCOUNT_INACTIVE",
        "message": "This account is inactive. Contact an administrator to restore access.",
    }


async def test_refresh_returns_the_same_inactive_account_code() -> None:
    user = SimpleNamespace(id=7, is_active=False)
    revoke_all_refresh_tokens_for_user = AsyncMock()
    auth_service = SimpleNamespace(
        rotate_refresh_token=AsyncMock(return_value=(user, "", None, "", None)),
        revoke_all_refresh_tokens_for_user=revoke_all_refresh_tokens_for_user,
    )

    with pytest.raises(HTTPException) as error:
        await undecorated(refresh_access_token)(
            request=loopback_request(),
            response=Response(),
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


async def test_non_admin_user_is_forbidden_and_admin_is_allowed() -> None:
    regular_user = User(is_active=True, is_admin=False)
    with pytest.raises(HTTPException) as error:
        await get_current_admin_user(regular_user)
    assert error.value.status_code == 403
    assert cast(dict[str, str], error.value.detail)["code"] == "ADMIN_REQUIRED"

    admin_user = User(is_active=True, is_admin=True)
    assert await get_current_admin_user(admin_user) is admin_user
