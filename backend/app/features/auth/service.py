"""Authentication orchestration: login and logout flows, user management.

Composes the token lifecycle and email-change policies from their domain
packages; this module keeps the flows that answer the router.
"""

from datetime import UTC, datetime, timedelta
from typing import override

import httpx
import jwt
import structlog
from fastapi import HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jwt import ExpiredSignatureError, InvalidTokenError
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_global_settings

from .email_change.email_change_service import (
    EMAIL_CHANGE_CODE_EXPIRY_MINUTES as EMAIL_CHANGE_CODE_EXPIRY_MINUTES,
)
from .email_change.email_change_service import (
    EMAIL_CHANGE_LOCK_MINUTES as EMAIL_CHANGE_LOCK_MINUTES,
)
from .email_change.email_change_service import (
    EMAIL_CHANGE_MAX_FAILED_ATTEMPTS as EMAIL_CHANGE_MAX_FAILED_ATTEMPTS,
)
from .email_change.email_change_service import EmailChangeMixin
from .errors import (
    AccountLockedError,
    CaptchaRequiredError,
    CaptchaVerificationError,
    EmailAlreadyRegisteredError,
    InvalidCurrentPasswordError,
    JoinUsBodyTooShortError,
    JoinUsCaptchaRequiredError,
    JoinUsCaptchaVerificationError,
)
from .join_us.join_us import (
    JOIN_US_CONTACT_RECIPIENT,
    JOIN_US_MIN_BODY_LENGTH,
    enforce_regular_rate_limit,
    record_submission,
    reserve_sequence_number,
    send_contact_email,
)
from .schemas import (
    JoinUsSubject,
    UserCreate,
    UserProfileUpdate,
)
from .tokens.refresh_token import RefreshToken
from .tokens.revoked_access_token import RevokedAccessToken
from .tokens.token_service import TokenLifecycleMixin
from .users.models import User
from .users.passwords import DUMMY_PASSWORD_HASH, hash_password, verify_password

oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl="/api/v1/auth/login",
    auto_error=False,
)

logger = structlog.get_logger(__name__)


class AuthService(EmailChangeMixin, TokenLifecycleMixin):
    """Service for authentication operations."""

    def __init__(self, db: AsyncSession):
        """Initialize auth service."""
        self.db = db
        self.settings = get_global_settings()

    @override
    async def get_user_by_email_case_insensitive(self, email: str) -> User | None:
        """Get a user by email address using case-insensitive comparison."""
        normalized_email = email.strip().lower()
        result = await self.db.execute(
            select(User).where(func.lower(User.email) == normalized_email)
        )
        return result.scalar_one_or_none()

    @override
    async def get_user_by_id(self, user_id: int) -> User | None:
        """Get a user by ID."""
        result = await self.db.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()

    async def list_users(self) -> list[User]:
        """List all users."""
        result = await self.db.execute(select(User))
        return list(result.scalars().all())

    async def update_profile(self, user: User, update: UserProfileUpdate) -> User:
        """Apply profile field updates and persist them."""
        if update.display_name is not None:
            user.display_name = update.display_name

        user.updated_at = datetime.now(UTC)
        await self.db.commit()
        await self.db.refresh(user)
        return user

    async def submit_join_us_contact_request(
        self,
        *,
        subject: JoinUsSubject,
        body: str,
        captcha_token: str | None = None,
        remote_ip: str | None = None,
    ) -> str:
        """Validate and deliver Join Us contact submissions."""
        normalized_body = body.strip()

        if len(normalized_body) < JOIN_US_MIN_BODY_LENGTH:
            raise JoinUsBodyTooShortError

        await enforce_regular_rate_limit(self.db, remote_ip)

        if self.is_captcha_enabled():
            if not captcha_token:
                raise JoinUsCaptchaRequiredError
            captcha_valid = await self.verify_turnstile_token(
                captcha_token,
                remote_ip,
            )
            if not captcha_valid:
                raise JoinUsCaptchaVerificationError

        sequence_number = await reserve_sequence_number(self.db, subject)

        subject_line = await send_contact_email(
            subject=subject,
            sequence_number=sequence_number,
            body=normalized_body,
            remote_ip=remote_ip,
        )

        await record_submission(
            self.db,
            remote_ip=remote_ip,
            subject=subject,
        )

        logger.info(
            "join_us_contact_submitted",
            subject=subject.value,
            sequence_number=sequence_number,
            recipient=JOIN_US_CONTACT_RECIPIENT,
        )
        return subject_line

    async def cleanup_expired_token_state(self) -> None:
        """Delete expired refresh and revoked access tokens."""
        now = datetime.now(UTC)
        await self.db.execute(
            delete(RevokedAccessToken).where(RevokedAccessToken.expires_at <= now)
        )
        await self.db.execute(
            delete(RefreshToken).where(RefreshToken.expires_at <= now)
        )
        await self.db.commit()

    def is_captcha_enabled(self) -> bool:
        """Return True when Turnstile secret is configured."""
        return bool(self.settings.turnstile_secret_key)

    def _is_captcha_required_for_user(self, user: User) -> bool:
        """Return True when account has enough failures to require CAPTCHA."""
        return (
            self.is_captcha_enabled()
            and user.failed_login_attempts >= self.settings.auth_captcha_after_failures
        )

    async def verify_turnstile_token(
        self,
        token: str,
        remote_ip: str | None = None,
    ) -> bool:
        """Verify a Cloudflare Turnstile token using server-side validation.

        Every failure mode -- no secret, transport error, rejected token --
        collapses to False, which callers must read as "retry the challenge".
        """
        if not self.settings.turnstile_secret_key:
            return False

        payload = {
            "secret": self.settings.turnstile_secret_key,
            "response": token,
        }

        if remote_ip:
            payload["remoteip"] = remote_ip

        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.post(
                    self.settings.turnstile_siteverify_url,
                    data=payload,
                )
                response.raise_for_status()
                verification_result = response.json()
        except (httpx.HTTPError, ValueError) as e:
            logger.warning("turnstile_verification_failed", error=str(e))
            return False

        is_valid = bool(verification_result.get("success"))
        if not is_valid:
            logger.info(
                "turnstile_verification_rejected",
                error_codes=verification_result.get("error-codes", []),
            )

        return is_valid

    async def _record_failed_login(self, user: User) -> None:
        """Record a failed login and lock account when threshold is reached."""
        now = datetime.now(UTC)
        user.failed_login_attempts += 1
        user.last_failed_login = now

        if user.failed_login_attempts >= self.settings.auth_lockout_max_attempts:
            lock_minutes = self.settings.auth_lockout_minutes
            user.locked_until = now + timedelta(minutes=lock_minutes)
            user.failed_login_attempts = 0
            logger.warning(
                "account_locked_due_to_failed_logins",
                user_id=user.id,
                email=user.email,
                lock_minutes=lock_minutes,
            )

        await self.db.commit()

    async def _clear_expired_lock_if_needed(self, user: User) -> None:
        """Clear stale lock metadata once lockout period has passed."""
        if user.locked_until is None:
            return

        now = datetime.now(UTC)
        if user.locked_until > now:
            return

        user.locked_until = None
        user.failed_login_attempts = 0
        await self.db.commit()

    async def authenticate_user(
        self,
        email: str,
        password: str,
        captcha_token: str | None = None,
        remote_ip: str | None = None,
    ) -> User | None:
        """Authenticate a user with email and password.

        Constant-time whether or not the email exists, so timing reveals
        nothing; lockout/CAPTCHA errors raise when policy refuses first.

        Returns:
            The user, or None for an unknown email or a wrong password.
        """
        user = await self.get_user_by_email_case_insensitive(email)

        # Always hash password to prevent timing attacks
        if not user:
            await verify_password(password, DUMMY_PASSWORD_HASH)
            logger.warning("login_failed", reason="unknown_email", email=email)
            return None

        await self._clear_expired_lock_if_needed(user)

        if user.locked_until and user.locked_until > datetime.now(UTC):
            raise AccountLockedError(user.locked_until)

        if self._is_captcha_required_for_user(user):
            if not captcha_token:
                raise CaptchaRequiredError
            captcha_valid = await self.verify_turnstile_token(captcha_token, remote_ip)
            if not captcha_valid:
                raise CaptchaVerificationError

        if not await verify_password(password, user.password_hash):
            await self._record_failed_login(user)
            logger.warning(
                "login_failed",
                reason="invalid_password",
                user_id=user.id,
                email=user.email,
            )
            return None

        return user

    async def create_user(self, user_create: UserCreate) -> User:
        """Create a new user.

        Raises:
            EmailAlreadyRegisteredError: If the email already has an account.
        """
        existing_user = await self.get_user_by_email_case_insensitive(user_create.email)
        if existing_user:
            raise EmailAlreadyRegisteredError

        hashed_password = await hash_password(user_create.password)
        user = User(
            email=user_create.email,
            display_name=user_create.display_name,
            password_hash=hashed_password,
            is_active=True,
            is_admin=False,
            email_verified=False,
        )

        self.db.add(user)
        await self.db.commit()
        await self.db.refresh(user)

        logger.info("user_registered", user_id=user.id, email=user.email)
        return user

    async def change_password(
        self,
        *,
        current_user: User,
        current_password: str,
        new_password: str,
    ) -> None:
        """Change current user's password hash."""
        if not await verify_password(current_password, current_user.password_hash):
            raise InvalidCurrentPasswordError

        current_user.password_hash = await hash_password(new_password)
        await self.db.commit()

        logger.info("password_changed", user_id=current_user.id)

    async def update_last_login(self, user_id: int) -> None:
        """Update successful-login metadata and clear lockout counters."""
        user = await self.get_user_by_id(user_id)
        if user:
            now = datetime.now(UTC)
            user.last_login = now
            user.failed_login_attempts = 0
            user.locked_until = None
            await self.db.commit()

    @staticmethod
    def _unauthenticated_credentials_error() -> HTTPException:
        """Build the standard 401 used for invalid or incomplete access tokens."""
        return HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Your session is invalid or expired. Please sign in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Not a FastAPI dependency: `dependencies.get_current_user` is, and it
    # passes the token in.
    async def get_current_user(self, token: str) -> User:
        """Get the current authenticated user from JWT token."""
        credentials_exception = self._unauthenticated_credentials_error()

        try:
            payload = jwt.decode(
                token,
                self.settings.jwt_secret_key,
                algorithms=[self.settings.jwt_algorithm],
            )
            token_data = self._access_token_data_from_payload(payload)
        except ExpiredSignatureError as e:
            logger.warning("access_token_rejected", reason="expired_token")
            raise credentials_exception from e
        except InvalidTokenError as e:
            logger.warning("access_token_rejected", reason="invalid_token")
            raise credentials_exception from e

        if (
            token_data is None
            or token_data.user_id is None
            or token_data.token_id is None
        ):
            logger.warning("access_token_rejected", reason="invalid_token")
            raise credentials_exception

        is_revoked = await self.is_access_token_revoked(token_data.token_id)
        if is_revoked:
            logger.warning(
                "access_token_rejected",
                reason="revoked_token",
                token_id=token_data.token_id,
            )
            raise credentials_exception

        user = await self.get_user_by_id(token_data.user_id)
        if user is None:
            logger.warning(
                "access_token_rejected",
                reason="unknown_user",
                user_id=token_data.user_id,
            )
            raise credentials_exception

        return user
