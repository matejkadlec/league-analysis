"""Security-event logging coverage for the authentication flows."""

import warnings
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock

import jwt
import pytest
from fastapi import HTTPException, Response
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import ClauseElement
from sqlalchemy.ext.asyncio import AsyncSession
from structlog.testing import capture_logs
from structlog.typing import EventDict

from app.core.config import get_global_settings
from app.features.auth.dependencies import (
    get_current_active_user,
    get_current_admin_user,
)
from app.features.auth.errors import (
    AccountLockedError,
    CaptchaRequiredError,
    CaptchaVerificationError,
)
from app.features.auth.models import User
from app.features.auth.passwords import DUMMY_PASSWORD_HASH, pwd_context
from app.features.auth.router import login
from app.features.auth.service import AuthService
from app.features.auth.token_service import TokenPair
from route_helpers import loopback_request, undecorated


class _Result:
    def __init__(self, scalar: object | None) -> None:
        self._scalar = scalar

    def scalar_one_or_none(self) -> object | None:
        return self._scalar


class _Session:
    """AsyncSession double serving queued scalar results per query."""

    def __init__(self, scalars: list[object | None]) -> None:
        self._scalars = list(scalars)
        self.commits = 0

    async def execute(self, _statement: ClauseElement) -> _Result:
        if self._scalars:
            return _Result(self._scalars.pop(0))
        return _Result(None)

    async def commit(self) -> None:
        self.commits += 1


def _auth_service(scalars: list[object | None]) -> AuthService:
    return AuthService(cast(AsyncSession, _Session(scalars)))


def _access_token(*, expires_in_minutes: int = 30, typ: str = "access") -> str:
    settings = get_global_settings()
    now = datetime.now(UTC)
    return jwt.encode(
        {
            "sub": "player@example.com",
            "user_id": 7,
            "jti": "token-id-1",
            "typ": typ,
            "iat": now,
            "exp": now + timedelta(minutes=expires_in_minutes),
        },
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )


def _events(records: list[EventDict], event: str) -> list[EventDict]:
    return [record for record in records if record["event"] == event]


with warnings.catch_warnings():
    # Warming passlib's argon2 backend here keeps its deprecated
    # argon2.__version__ probe from firing inside warnings-as-error tests.
    warnings.simplefilter("ignore", DeprecationWarning)
    _ = pwd_context.verify("warm-up-probe", DUMMY_PASSWORD_HASH)


async def test_unknown_email_login_failure_is_logged() -> None:
    service = _auth_service([None])

    with capture_logs() as records:
        user = await service.authenticate_user("ghost@example.com", "Password-1!")

    assert user is None
    failures = _events(records, "login_failed")
    assert len(failures) == 1
    assert failures[0]["reason"] == "unknown_email"
    assert failures[0]["email"] == "ghost@example.com"


async def test_invalid_password_login_failure_is_logged() -> None:
    stored_user = User(
        id=7,
        email="player@example.com",
        display_name="Player",
        password_hash=DUMMY_PASSWORD_HASH,
        is_active=True,
        failed_login_attempts=0,
        locked_until=None,
    )
    service = _auth_service([stored_user])

    with capture_logs() as records:
        user = await service.authenticate_user(
            "player@example.com", "Different-password-2!"
        )

    assert user is None
    failures = _events(records, "login_failed")
    assert len(failures) == 1
    assert failures[0]["reason"] == "invalid_password"
    assert failures[0]["user_id"] == 7
    assert failures[0]["email"] == "player@example.com"


async def test_inactive_account_login_failure_is_logged() -> None:
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

    with capture_logs() as records, pytest.raises(HTTPException) as error:
        await undecorated(login)(
            request=loopback_request(),
            response=Response(),
            form_data=form_data,
            auth_service=cast(AuthService, auth_service),
        )

    assert error.value.status_code == 403
    failures = _events(records, "login_failed")
    assert len(failures) == 1
    assert failures[0]["reason"] == "inactive_account"
    assert failures[0]["user_id"] == 7


async def test_locked_account_login_failure_is_logged() -> None:
    auth_service = SimpleNamespace(
        authenticate_user=AsyncMock(
            side_effect=AccountLockedError(
                locked_until=datetime.now(UTC) + timedelta(minutes=5)
            )
        )
    )
    form_data = OAuth2PasswordRequestForm(
        username="player@example.com", password="Password-1!"
    )

    with capture_logs() as records, pytest.raises(HTTPException) as error:
        await undecorated(login)(
            request=loopback_request(),
            response=Response(),
            form_data=form_data,
            auth_service=cast(AuthService, auth_service),
        )

    assert error.value.status_code == 423
    failures = _events(records, "login_failed")
    assert len(failures) == 1
    assert failures[0]["reason"] == "account_locked"
    assert failures[0]["email"] == "player@example.com"


async def test_captcha_required_login_failure_is_logged() -> None:
    auth_service = SimpleNamespace(
        authenticate_user=AsyncMock(side_effect=CaptchaRequiredError())
    )
    form_data = OAuth2PasswordRequestForm(
        username="player@example.com", password="Password-1!"
    )

    with capture_logs() as records, pytest.raises(HTTPException) as error:
        await undecorated(login)(
            request=loopback_request(),
            response=Response(),
            form_data=form_data,
            auth_service=cast(AuthService, auth_service),
        )

    assert error.value.status_code == 403
    failures = _events(records, "login_failed")
    assert len(failures) == 1
    assert failures[0]["reason"] == "captcha_required"
    assert failures[0]["email"] == "player@example.com"


async def test_captcha_verification_failure_is_logged() -> None:
    auth_service = SimpleNamespace(
        authenticate_user=AsyncMock(side_effect=CaptchaVerificationError())
    )
    form_data = OAuth2PasswordRequestForm(
        username="player@example.com", password="Password-1!"
    )

    with capture_logs() as records, pytest.raises(HTTPException) as error:
        await undecorated(login)(
            request=loopback_request(),
            response=Response(),
            form_data=form_data,
            auth_service=cast(AuthService, auth_service),
        )

    assert error.value.status_code == 403
    failures = _events(records, "login_failed")
    assert len(failures) == 1
    assert failures[0]["reason"] == "captcha_verification_failed"
    assert failures[0]["email"] == "player@example.com"


async def test_successful_login_is_logged() -> None:
    now = datetime.now(UTC)
    auth_service = SimpleNamespace(
        authenticate_user=AsyncMock(
            return_value=SimpleNamespace(
                id=7, is_active=True, email="player@example.com"
            )
        ),
        issue_token_pair=AsyncMock(
            return_value=TokenPair(
                access_token="access-token",
                access_expires_at=now,
                refresh_token="refresh-token",
                refresh_expires_at=now,
            )
        ),
        update_last_login=AsyncMock(),
        cleanup_expired_token_state=AsyncMock(),
    )
    form_data = OAuth2PasswordRequestForm(
        username="player@example.com", password="Password-1!"
    )

    with capture_logs() as records:
        token = await undecorated(login)(
            request=loopback_request(),
            response=Response(),
            form_data=form_data,
            auth_service=cast(AuthService, auth_service),
        )

    assert token.access_token == "access-token"
    successes = _events(records, "login_succeeded")
    assert len(successes) == 1
    assert successes[0]["user_id"] == 7
    assert successes[0]["email"] == "player@example.com"


async def test_malformed_access_token_rejection_is_logged() -> None:
    service = _auth_service([])

    with capture_logs() as records, pytest.raises(HTTPException) as error:
        await service.get_current_user("not-a-jwt")

    assert error.value.status_code == 401
    rejections = _events(records, "access_token_rejected")
    assert len(rejections) == 1
    assert rejections[0]["reason"] == "invalid_token"


async def test_wrong_token_type_rejection_is_logged() -> None:
    service = _auth_service([])

    with capture_logs() as records, pytest.raises(HTTPException) as error:
        await service.get_current_user(_access_token(typ="refresh"))

    assert error.value.status_code == 401
    rejections = _events(records, "access_token_rejected")
    assert len(rejections) == 1
    assert rejections[0]["reason"] == "invalid_token"


async def test_expired_access_token_rejection_is_logged() -> None:
    service = _auth_service([])

    with capture_logs() as records, pytest.raises(HTTPException) as error:
        await service.get_current_user(_access_token(expires_in_minutes=-5))

    assert error.value.status_code == 401
    rejections = _events(records, "access_token_rejected")
    assert len(rejections) == 1
    assert rejections[0]["reason"] == "expired_token"


async def test_revoked_access_token_rejection_is_logged() -> None:
    service = _auth_service([object()])

    with capture_logs() as records, pytest.raises(HTTPException) as error:
        await service.get_current_user(_access_token())

    assert error.value.status_code == 401
    rejections = _events(records, "access_token_rejected")
    assert len(rejections) == 1
    assert rejections[0]["reason"] == "revoked_token"
    assert rejections[0]["token_id"] == "token-id-1"


async def test_unknown_user_access_token_rejection_is_logged() -> None:
    service = _auth_service([None, None])

    with capture_logs() as records, pytest.raises(HTTPException) as error:
        await service.get_current_user(_access_token())

    assert error.value.status_code == 401
    rejections = _events(records, "access_token_rejected")
    assert len(rejections) == 1
    assert rejections[0]["reason"] == "unknown_user"
    assert rejections[0]["user_id"] == 7


async def test_inactive_user_access_denial_is_logged() -> None:
    user = User(id=7, is_active=False, is_admin=True)

    with capture_logs() as records, pytest.raises(HTTPException) as error:
        await get_current_active_user(user)

    assert error.value.status_code == 403
    denials = _events(records, "inactive_user_access_denied")
    assert len(denials) == 1
    assert denials[0]["user_id"] == 7


async def test_admin_access_denial_is_logged() -> None:
    user = User(id=7, is_active=True, is_admin=False)

    with capture_logs() as records, pytest.raises(HTTPException) as error:
        await get_current_admin_user(user)

    assert error.value.status_code == 403
    denials = _events(records, "admin_access_denied")
    assert len(denials) == 1
    assert denials[0]["user_id"] == 7
