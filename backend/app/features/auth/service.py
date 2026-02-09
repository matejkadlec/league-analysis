"""Authentication service for user management, JWT access tokens, and refresh sessions."""

from datetime import datetime, timedelta, timezone
import hashlib
import secrets
from typing import Optional
from uuid import uuid4

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
import structlog

from app.core.database import get_db
from app.core.config import get_global_settings
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


class AccountLockedError(Exception):
    """Raised when a user account is temporarily locked after failed logins."""

    def __init__(self, locked_until: datetime):
        self.locked_until = locked_until
        super().__init__("Account is temporarily locked")


class CaptchaRequiredError(Exception):
    """Raised when a login attempt must provide a CAPTCHA token."""


class CaptchaVerificationError(Exception):
    """Raised when a CAPTCHA token is missing, invalid, or cannot be verified."""


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

    async def get_user_by_id(self, user_id: int) -> Optional[User]:
        """Get a user by ID."""
        result = await self.db.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()

    @staticmethod
    def _hash_refresh_token(raw_token: str) -> str:
        """Hash refresh token before storing in database."""
        return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()

    @staticmethod
    def _generate_token_id() -> str:
        """Generate a unique token identifier (jti)."""
        return str(uuid4())

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
