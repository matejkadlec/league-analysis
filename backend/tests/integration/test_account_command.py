"""The account command against a real database.

It is the only way an account comes into being, so what it writes -- the role,
the verified flag, a login that works -- is checked on stored rows.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.auth.service import AuthService
from app.features.auth.users.models import User
from scripts.account import AccountRefusal, save_account, validated_account

pytestmark = [
    pytest.mark.integration,
    pytest.mark.enable_socket,
    # Real Argon2id, unlike the rest of the suite: passlib reads the deprecated
    # `argon2.__version__` when it first loads the backend, and this project's
    # `filterwarnings = error` would turn that into the test's failure.
    pytest.mark.filterwarnings(
        "ignore:Accessing argon2.__version__ is deprecated:DeprecationWarning"
    ),
]

EMAIL = "operator@example.com"
PASSWORD = "First-Passw0rd!"


async def _stored(session: AsyncSession) -> User:
    result = await session.execute(select(User).where(User.email == EMAIL))
    return result.scalar_one()


async def test_a_created_account_is_active_verified_and_can_log_in(
    database_session: AsyncSession,
) -> None:
    account = validated_account(email=EMAIL, display_name="Operator", password=PASSWORD)

    user_id, created = await save_account(
        database_session, account=account, is_admin=True, update_existing=False
    )

    user = await _stored(database_session)
    assert created is True
    assert (user.id, user.is_active, user.is_admin) == (user_id, True, True)
    assert user.email_verified is True
    assert user.email_verified_at is not None
    authenticated = await AuthService(database_session).authenticate_user(
        EMAIL, PASSWORD
    )
    assert authenticated is not None
    assert authenticated.id == user_id


async def test_a_regular_account_is_not_an_administrator(
    database_session: AsyncSession,
) -> None:
    account = validated_account(email=EMAIL, display_name="Operator", password=PASSWORD)

    await save_account(
        database_session, account=account, is_admin=False, update_existing=False
    )

    assert (await _stored(database_session)).is_admin is False


async def test_an_existing_account_is_never_changed_without_update(
    database_session: AsyncSession,
) -> None:
    """A second run with another password must not silently reset the first."""
    first = validated_account(email=EMAIL, display_name="Operator", password=PASSWORD)
    await save_account(
        database_session, account=first, is_admin=True, update_existing=False
    )
    second = validated_account(
        email=EMAIL.upper(), display_name="Somebody", password="Other-Passw0rd!"
    )

    with pytest.raises(AccountRefusal, match="already exists"):
        await save_account(
            database_session, account=second, is_admin=False, update_existing=False
        )

    user = await _stored(database_session)
    assert (user.display_name, user.is_admin) == ("Operator", True)
    count = await database_session.scalar(select(func.count()).select_from(User))
    assert count == 1


async def test_update_refuses_an_unknown_email(
    database_session: AsyncSession,
) -> None:
    """A mistyped address must not create a second account."""
    account = validated_account(email=EMAIL, display_name="Operator", password=PASSWORD)

    with pytest.raises(AccountRefusal, match="no account has this email"):
        await save_account(
            database_session, account=account, is_admin=True, update_existing=True
        )

    count = await database_session.scalar(select(func.count()).select_from(User))
    assert count == 0


async def test_update_replaces_the_password_and_clears_a_lockout(
    database_session: AsyncSession,
) -> None:
    first = validated_account(email=EMAIL, display_name="Operator", password=PASSWORD)
    user_id, _ = await save_account(
        database_session, account=first, is_admin=False, update_existing=False
    )
    locked = await _stored(database_session)
    locked.failed_login_attempts = 5
    locked.locked_until = datetime.now(UTC) + timedelta(minutes=15)
    await database_session.commit()
    replacement = validated_account(
        email=EMAIL, display_name="Operator", password="Second-Passw0rd!"
    )

    updated_id, created = await save_account(
        database_session, account=replacement, is_admin=True, update_existing=True
    )

    user = await _stored(database_session)
    assert (updated_id, created) == (user_id, False)
    assert (user.is_admin, user.failed_login_attempts, user.locked_until) == (
        True,
        0,
        None,
    )
    auth_service = AuthService(database_session)
    assert await auth_service.authenticate_user(EMAIL, "Second-Passw0rd!") is not None
    assert await auth_service.authenticate_user(EMAIL, PASSWORD) is None
