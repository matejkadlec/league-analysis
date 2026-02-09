"""Authentication service for user management, JWT access tokens, and refresh sessions."""

import asyncio
from datetime import datetime, timedelta, timezone
import hashlib
import secrets
import smtplib
from email.message import EmailMessage
from typing import Optional
from uuid import uuid4

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
import structlog

from app.core.database import get_db
from app.core.config import get_global_settings
from .email_change_request import EmailChangeRequest
from .models import User
from .refresh_token import RefreshToken
from .revoked_access_token import RevokedAccessToken
from .schemas import TokenData, UserCreate

# Password hashing context using Argon2id
pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")

# OAuth2 scheme for token authentication
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")

logger = structlog.get_logger(__name__)

# Pre-computed Argon2 hash of "dummy_password_for_timing_protection"
DUMMY_PASSWORD_HASH = "$argon2id$v=19$m=65536,t=3,p=4$qNVaS2lNCcH4vzfG+P9fSw$VpLQUmDVmdNQm7w0VIYso0IyglZSf1VDJ7qtaRkmnNQ"

EMAIL_CHANGE_CODE_LENGTH = 6
EMAIL_CHANGE_CODE_EXPIRY_MINUTES = 10
EMAIL_CHANGE_MAX_FAILED_ATTEMPTS = 3
EMAIL_CHANGE_LOCK_MINUTES = 5


class AccountLockedError(Exception):
    """Raised when a user account is temporarily locked after failed logins."""

    def __init__(self, locked_until: datetime):
        self.locked_until = locked_until
        super().__init__("Account is temporarily locked")


class CaptchaRequiredError(Exception):
    """Raised when a login attempt must provide a CAPTCHA token."""


class CaptchaVerificationError(Exception):
    """Raised when a CAPTCHA token is missing, invalid, or cannot be verified."""


class EmailChangeLockedError(Exception):
    """Raised when email-change actions are temporarily locked for a user."""

    def __init__(self, locked_until: datetime):
        self.locked_until = locked_until
        super().__init__("Email change is temporarily locked")


class EmailAlreadyRegisteredError(Exception):
    """Raised when the target email is already used by another account."""


class EmailUnchangedError(Exception):
    """Raised when a user requests to change to the currently active email."""


class InvalidEmailVerificationCodeError(Exception):
    """Raised when an email verification code does not match."""

    def __init__(self, attempts_remaining: int):
        self.attempts_remaining = attempts_remaining
        super().__init__("Verification code is incorrect")


class EmailVerificationCodeExpiredError(Exception):
    """Raised when the verification code is no longer valid."""


class EmailVerificationRequestNotFoundError(Exception):
    """Raised when there is no pending email verification request."""


class AuthService:
    """Service for authentication operations."""

    def __init__(self, db: AsyncSession):
        """Initialize auth service."""
        self.db = db
        self.settings = get_global_settings()

    @staticmethod
    def verify_password(plain_password: str, hashed_password: str) -> bool:
        """Verify a password against its hash."""
        return pwd_context.verify(plain_password, hashed_password)

    @staticmethod
    def get_password_hash(password: str) -> str:
        """Hash a password using Argon2id."""
        return pwd_context.hash(password)

    async def get_user_by_email(self, email: str) -> Optional[User]:
        """Get a user by email address."""
        result = await self.db.execute(select(User).where(User.email == email))
        return result.scalar_one_or_none()

    async def get_user_by_email_case_insensitive(self, email: str) -> Optional[User]:
        """Get a user by email address using case-insensitive comparison."""
        normalized_email = email.strip().lower()
        result = await self.db.execute(
            select(User).where(func.lower(User.email) == normalized_email)
        )
        return result.scalar_one_or_none()

    async def get_user_by_id(self, user_id: int) -> Optional[User]:
        """Get a user by ID."""
        result = await self.db.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()

    async def _get_or_create_email_change_request(
        self, user_id: int
    ) -> EmailChangeRequest:
        """Get or create email-change verification state for a user."""
        result = await self.db.execute(
            select(EmailChangeRequest).where(EmailChangeRequest.user_id == user_id)
        )
        request = result.scalar_one_or_none()
        if request is not None:
            return request

        request = EmailChangeRequest(user_id=user_id)
        self.db.add(request)
        await self.db.flush()
        return request

    @staticmethod
    def _hash_refresh_token(raw_token: str) -> str:
        """Hash refresh token before storing in database."""
        return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()

    @staticmethod
    def _hash_email_verification_code(raw_code: str) -> str:
        """Hash email verification code before storing it."""
        return hashlib.sha256(raw_code.encode("utf-8")).hexdigest()

    @staticmethod
    def _generate_email_verification_code() -> str:
        """Generate random 6-digit numeric verification code."""
        return f"{secrets.randbelow(1_000_000):0{EMAIL_CHANGE_CODE_LENGTH}d}"

    @staticmethod
    def _generate_token_id() -> str:
        """Generate a unique token identifier (jti)."""
        return str(uuid4())

    def _is_smtp_configured(self) -> bool:
        """Return True when SMTP delivery settings are configured."""
        return bool(self.settings.smtp_host and self.settings.smtp_from_email)

    async def _send_email_verification_code(
        self,
        *,
        target_email: str,
        code: str,
    ) -> None:
        """Send email-change verification code.

        Falls back to structured logs when SMTP is not configured.
        """
        if not self._is_smtp_configured():
            logger.warning(
                "smtp_not_configured_email_code_logged",
                target_email=target_email,
                code=code,
                note="Set SMTP_* variables in .env to send real emails",
            )
            return

        smtp_host = self.settings.smtp_host
        smtp_port = self.settings.smtp_port
        smtp_username = self.settings.smtp_username
        smtp_password = self.settings.smtp_password
        smtp_from_email = self.settings.smtp_from_email
        smtp_use_tls = self.settings.smtp_use_tls

        subject = "League Analysis - Verify Your New Email"
        body = (
            "Your verification code is: "
            f"{code}\n\n"
            f"This code expires in {EMAIL_CHANGE_CODE_EXPIRY_MINUTES} minutes.\n"
            "If you did not request this change, you can safely ignore this email."
        )

        message = EmailMessage()
        message["Subject"] = subject
        message["From"] = smtp_from_email
        message["To"] = target_email
        message.set_content(body)

        def send_blocking() -> None:
            with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as smtp:
                if smtp_use_tls:
                    smtp.starttls()
                if smtp_username:
                    smtp.login(smtp_username, smtp_password)
                smtp.send_message(message)

        await asyncio.to_thread(send_blocking)

    async def cleanup_expired_token_state(self) -> None:
        """Delete expired refresh and revoked access tokens."""
        now = datetime.now(timezone.utc)
        await self.db.execute(
            delete(RevokedAccessToken).where(RevokedAccessToken.expires_at <= now)
        )
        await self.db.execute(delete(RefreshToken).where(RefreshToken.expires_at <= now))
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
        """Verify a Cloudflare Turnstile token using server-side validation."""
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
        now = datetime.now(timezone.utc)
        user.failed_login_attempts += 1
        user.last_failed_login = now
        user.updated_at = now

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

        now = datetime.now(timezone.utc)
        if user.locked_until > now:
            return

        user.locked_until = None
        user.failed_login_attempts = 0
        user.updated_at = now
        await self.db.commit()

    def create_access_token(
        self,
        user: User,
        expires_delta: Optional[timedelta] = None,
    ) -> tuple[str, datetime, str]:
        """Create a signed JWT access token with token ID for revocation checks."""
        token_id = self._generate_token_id()
        now = datetime.now(timezone.utc)

        if expires_delta:
            expire = now + expires_delta
        else:
            expire = now + timedelta(
                minutes=self.settings.jwt_access_token_expire_minutes
            )

        payload = {
            "sub": user.email,
            "user_id": user.id,
            "jti": token_id,
            "typ": "access",
            "iat": now,
            "exp": expire,
        }

        encoded_jwt = jwt.encode(
            payload,
            self.settings.jwt_secret_key,
            algorithm=self.settings.jwt_algorithm,
        )
        return encoded_jwt, expire, token_id

    async def create_refresh_token(
        self,
        user_id: int,
        remote_ip: str | None = None,
        user_agent: str | None = None,
        expires_delta: Optional[timedelta] = None,
    ) -> tuple[str, datetime, str]:
        """Create and persist a refresh token, returning the raw token once."""
        now = datetime.now(timezone.utc)
        refresh_token = secrets.token_urlsafe(64)
        token_id = self._generate_token_id()
        token_hash = self._hash_refresh_token(refresh_token)

        if expires_delta:
            expires_at = now + expires_delta
        else:
            expires_at = now + timedelta(days=self.settings.jwt_refresh_token_expire_days)

        record = RefreshToken(
            user_id=user_id,
            token_id=token_id,
            token_hash=token_hash,
            issued_at=now,
            expires_at=expires_at,
            created_from_ip=remote_ip,
            user_agent=user_agent[:255] if user_agent else None,
        )
        self.db.add(record)
        await self.db.commit()

        return refresh_token, expires_at, token_id

    async def issue_token_pair(
        self,
        user: User,
        remote_ip: str | None = None,
        user_agent: str | None = None,
    ) -> tuple[str, datetime, str, datetime]:
        """Issue a fresh access/refresh token pair for a user."""
        access_token, access_expires_at, _ = self.create_access_token(user)
        refresh_token, refresh_expires_at, _ = await self.create_refresh_token(
            user_id=user.id,
            remote_ip=remote_ip,
            user_agent=user_agent,
        )
        return access_token, access_expires_at, refresh_token, refresh_expires_at

    async def rotate_refresh_token(
        self,
        raw_refresh_token: str,
        remote_ip: str | None = None,
        user_agent: str | None = None,
    ) -> Optional[tuple[User, str, datetime, str, datetime]]:
        """Rotate refresh token and return new access/refresh pair."""
        token_hash = self._hash_refresh_token(raw_refresh_token)
        result = await self.db.execute(
            select(RefreshToken).where(RefreshToken.token_hash == token_hash)
        )
        token_record = result.scalar_one_or_none()
        if token_record is None:
            return None

        now = datetime.now(timezone.utc)
        if token_record.revoked_at is not None:
            logger.warning(
                "refresh_token_reuse_detected",
                user_id=token_record.user_id,
                token_id=token_record.token_id,
            )
            await self.revoke_all_refresh_tokens_for_user(token_record.user_id)
            return None

        if token_record.expires_at <= now:
            token_record.revoked_at = now
            await self.db.commit()
            return None

        user = await self.get_user_by_id(token_record.user_id)
        if user is None:
            token_record.revoked_at = now
            await self.db.commit()
            return None

        token_record.revoked_at = now

        new_refresh_token = secrets.token_urlsafe(64)
        new_token_id = self._generate_token_id()
        new_token_hash = self._hash_refresh_token(new_refresh_token)
        refresh_expires_at = now + timedelta(days=self.settings.jwt_refresh_token_expire_days)

        token_record.replaced_by_token_id = new_token_id
        replacement = RefreshToken(
            user_id=user.id,
            token_id=new_token_id,
            token_hash=new_token_hash,
            issued_at=now,
            expires_at=refresh_expires_at,
            created_from_ip=remote_ip,
            user_agent=user_agent[:255] if user_agent else None,
        )
        self.db.add(replacement)
        await self.db.commit()

        access_token, access_expires_at, _ = self.create_access_token(user)
        return user, access_token, access_expires_at, new_refresh_token, refresh_expires_at

    async def revoke_all_refresh_tokens_for_user(self, user_id: int) -> None:
        """Revoke all active refresh tokens for a user."""
        result = await self.db.execute(
            select(RefreshToken).where(
                RefreshToken.user_id == user_id,
                RefreshToken.revoked_at.is_(None),
            )
        )
        active_tokens = list(result.scalars().all())
        if not active_tokens:
            return

        now = datetime.now(timezone.utc)
        for token in active_tokens:
            token.revoked_at = now

        await self.db.commit()

    async def revoke_access_token(
        self,
        access_token: str,
        reason: str = "logout",
    ) -> None:
        """Blacklist an access token by its jti claim until expiration."""
        try:
            payload = jwt.decode(
                access_token,
                self.settings.jwt_secret_key,
                algorithms=[self.settings.jwt_algorithm],
                options={"verify_exp": False},
            )
        except JWTError:
            return

        token_id = payload.get("jti")
        user_id = payload.get("user_id")
        token_type = payload.get("typ")
        exp = payload.get("exp")

        if (
            not isinstance(token_id, str)
            or not isinstance(user_id, int)
            or not isinstance(exp, int)
            or token_type != "access"
        ):
            return

        expires_at = datetime.fromtimestamp(exp, tz=timezone.utc)
        if expires_at <= datetime.now(timezone.utc):
            return

        existing = await self.db.execute(
            select(RevokedAccessToken).where(RevokedAccessToken.token_id == token_id)
        )
        if existing.scalar_one_or_none() is not None:
            return

        self.db.add(
            RevokedAccessToken(
                user_id=user_id,
                token_id=token_id,
                expires_at=expires_at,
                reason=reason,
            )
        )
        await self.db.commit()

    async def is_access_token_revoked(self, token_id: str) -> bool:
        """Return True when token ID exists in blacklist."""
        result = await self.db.execute(
            select(RevokedAccessToken).where(RevokedAccessToken.token_id == token_id)
        )
        return result.scalar_one_or_none() is not None

    async def authenticate_user(
        self,
        email: str,
        password: str,
        captcha_token: str | None = None,
        remote_ip: str | None = None,
    ) -> Optional[User]:
        """Authenticate a user with email and password.

        Uses constant-time comparison to prevent timing attacks that could
        reveal valid email addresses. Always hashes the password even when
        the user doesn't exist.
        """
        user = await self.get_user_by_email(email)

        # Always hash password to prevent timing attacks
        # If user doesn't exist, hash against a dummy value
        if not user:
            self.verify_password(password, DUMMY_PASSWORD_HASH)
            return None

        await self._clear_expired_lock_if_needed(user)

        if user.locked_until and user.locked_until > datetime.now(timezone.utc):
            raise AccountLockedError(user.locked_until)

        if self._is_captcha_required_for_user(user):
            if not captcha_token:
                raise CaptchaRequiredError
            captcha_valid = await self.verify_turnstile_token(captcha_token, remote_ip)
            if not captcha_valid:
                raise CaptchaVerificationError

        if not self.verify_password(password, user.password_hash):
            await self._record_failed_login(user)
            return None

        return user

    async def create_user(self, user_create: UserCreate) -> User:
        """Create a new user."""
        # Check if user already exists
        existing_user = await self.get_user_by_email(user_create.email)
        if existing_user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already registered",
            )

        # Create new user
        hashed_password = self.get_password_hash(user_create.password)
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

        return user

    async def request_email_change_code(
        self,
        *,
        current_user: User,
        new_email: str,
    ) -> datetime:
        """Generate and send a verification code for changing user email."""
        now = datetime.now(timezone.utc)
        normalized_email = new_email.strip().lower()

        if normalized_email == current_user.email.strip().lower():
            raise EmailUnchangedError

        existing_user = await self.get_user_by_email_case_insensitive(normalized_email)
        if existing_user is not None and existing_user.id != current_user.id:
            raise EmailAlreadyRegisteredError

        email_change_request = await self._get_or_create_email_change_request(
            current_user.id
        )

        if (
            email_change_request.locked_until is not None
            and email_change_request.locked_until > now
        ):
            raise EmailChangeLockedError(email_change_request.locked_until)

        verification_code = self._generate_email_verification_code()
        verification_code_hash = self._hash_email_verification_code(verification_code)
        expires_at = now + timedelta(minutes=EMAIL_CHANGE_CODE_EXPIRY_MINUTES)

        await self._send_email_verification_code(
            target_email=normalized_email,
            code=verification_code,
        )

        email_change_request.pending_email = normalized_email
        email_change_request.verification_code_hash = verification_code_hash
        email_change_request.code_expires_at = expires_at
        email_change_request.failed_attempts = 0
        email_change_request.locked_until = None
        email_change_request.updated_at = now

        await self.db.commit()

        logger.info(
            "email_change_code_requested",
            user_id=current_user.id,
            target_email=normalized_email,
            expires_at=expires_at.isoformat(),
        )

        return expires_at

    async def verify_email_change_code(
        self,
        *,
        current_user: User,
        code: str,
    ) -> User:
        """Validate the code and update current user's email on success."""
        now = datetime.now(timezone.utc)
        email_change_request = await self._get_or_create_email_change_request(
            current_user.id
        )

        if (
            email_change_request.locked_until is not None
            and email_change_request.locked_until > now
        ):
            raise EmailChangeLockedError(email_change_request.locked_until)

        if (
            email_change_request.pending_email is None
            or email_change_request.verification_code_hash is None
            or email_change_request.code_expires_at is None
        ):
            raise EmailVerificationRequestNotFoundError

        if email_change_request.code_expires_at <= now:
            email_change_request.verification_code_hash = None
            email_change_request.code_expires_at = None
            email_change_request.failed_attempts = 0
            email_change_request.updated_at = now
            await self.db.commit()
            raise EmailVerificationCodeExpiredError

        submitted_hash = self._hash_email_verification_code(code)
        is_match = secrets.compare_digest(
            email_change_request.verification_code_hash,
            submitted_hash,
        )

        if not is_match:
            email_change_request.failed_attempts += 1
            attempts_remaining = max(
                0,
                EMAIL_CHANGE_MAX_FAILED_ATTEMPTS - email_change_request.failed_attempts,
            )
            email_change_request.updated_at = now

            if email_change_request.failed_attempts >= EMAIL_CHANGE_MAX_FAILED_ATTEMPTS:
                locked_until = now + timedelta(minutes=EMAIL_CHANGE_LOCK_MINUTES)
                email_change_request.pending_email = None
                email_change_request.verification_code_hash = None
                email_change_request.code_expires_at = None
                email_change_request.failed_attempts = 0
                email_change_request.locked_until = locked_until
                await self.db.commit()
                raise EmailChangeLockedError(locked_until)

            await self.db.commit()
            raise InvalidEmailVerificationCodeError(attempts_remaining)

        existing_user = await self.get_user_by_email_case_insensitive(
            email_change_request.pending_email
        )
        if existing_user is not None and existing_user.id != current_user.id:
            raise EmailAlreadyRegisteredError

        current_user.email = email_change_request.pending_email
        current_user.email_verified = True
        current_user.email_verified_at = now
        current_user.updated_at = now

        email_change_request.pending_email = None
        email_change_request.verification_code_hash = None
        email_change_request.code_expires_at = None
        email_change_request.failed_attempts = 0
        email_change_request.locked_until = None
        email_change_request.updated_at = now

        await self.db.commit()
        await self.db.refresh(current_user)

        logger.info("email_changed", user_id=current_user.id)
        return current_user

    async def change_password(self, *, current_user: User, new_password: str) -> None:
        """Change current user's password hash."""
        now = datetime.now(timezone.utc)
        current_user.password_hash = self.get_password_hash(new_password)
        current_user.updated_at = now
        await self.db.commit()

        logger.info("password_changed", user_id=current_user.id)

    async def update_last_login(self, user_id: int) -> None:
        """Update successful-login metadata and clear lockout counters."""
        user = await self.get_user_by_id(user_id)
        if user:
            now = datetime.now(timezone.utc)
            user.last_login = now
            user.failed_login_attempts = 0
            user.locked_until = None
            user.updated_at = now
            await self.db.commit()

    async def get_current_user(self, token: str = Depends(oauth2_scheme)) -> User:
        """Get the current authenticated user from JWT token."""
        credentials_exception = HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

        try:
            payload = jwt.decode(
                token,
                self.settings.jwt_secret_key,
                algorithms=[self.settings.jwt_algorithm],
            )
            email = payload.get("sub")
            user_id = payload.get("user_id")
            token_id = payload.get("jti")
            token_type = payload.get("typ")
            exp = payload.get("exp")

            if (
                not isinstance(email, str)
                or not isinstance(user_id, int)
                or not isinstance(token_id, str)
                or token_type != "access"
                or not isinstance(exp, int)
            ):
                raise credentials_exception

            token_data = TokenData(
                email=email,
                user_id=user_id,
                token_id=token_id,
                token_type=token_type,
                exp=exp,
            )

        except JWTError:
            raise credentials_exception

        if token_data.user_id is None or token_data.token_id is None:
            raise credentials_exception

        is_revoked = await self.is_access_token_revoked(token_data.token_id)
        if is_revoked:
            raise credentials_exception

        user = await self.get_user_by_id(token_data.user_id)

        if user is None:
            raise credentials_exception

        return user


def get_auth_service(db: AsyncSession = Depends(get_db)) -> AuthService:
    """Dependency to get auth service instance."""
    return AuthService(db)
