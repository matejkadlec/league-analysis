# passlib has no stubs; `PasswordHasher` below states the contract instead.
# Mirrors `reportMissingTypeStubs = "none"` in pyproject.toml, which the
# file-level `strict` pragma otherwise discards.
# pyright: reportMissingTypeStubs=none
"""Authentication service for user management, JWT access tokens, and refresh sessions."""

import asyncio
import hashlib
import secrets
import smtplib
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from typing import NoReturn, Protocol
from uuid import uuid4

import httpx
import jwt
import structlog
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jwt import ExpiredSignatureError, InvalidTokenError
from passlib.context import CryptContext
from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_global_settings
from app.core.database import get_db

from .email_change_request import EmailChangeRequest
from .join_us_contact_submission import JoinUsContactSubmission
from .models import User
from .refresh_token import RefreshToken
from .revoked_access_token import RevokedAccessToken
from .schemas import JoinUsSubject, TokenData, UserCreate
from .subject_counts import SubjectCounts


class PasswordHasher(Protocol):
    """The slice of passlib's ``CryptContext`` this module depends on.

    passlib ships no type information, so every hashing call would otherwise
    be unchecked. Stating the contract here is what makes the two wrappers
    below verifiable.
    """

    def verify(self, secret: str, hash: str) -> bool:
        """Check a plaintext secret against a stored hash."""
        ...

    def hash(self, secret: str) -> str:
        """Hash a plaintext secret with the configured scheme."""
        ...


# Password hashing context using Argon2id
pwd_context: PasswordHasher = CryptContext(schemes=["argon2"], deprecated="auto")

# OAuth2 scheme for token authentication
oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl="/api/v1/auth/login",
    auto_error=False,
)

logger = structlog.get_logger(__name__)

# Pre-computed Argon2 hash of "dummy_password_for_timing_protection"
DUMMY_PASSWORD_HASH = "$argon2id$v=19$m=65536,t=3,p=4$qNVaS2lNCcH4vzfG+P9fSw$VpLQUmDVmdNQm7w0VIYso0IyglZSf1VDJ7qtaRkmnNQ"

EMAIL_CHANGE_CODE_LENGTH = 6
EMAIL_CHANGE_CODE_EXPIRY_MINUTES = 10
EMAIL_CHANGE_MAX_FAILED_ATTEMPTS = 3
EMAIL_CHANGE_LOCK_MINUTES = 5
JOIN_US_CONTACT_RECIPIENT = "contact@example.com"
JOIN_US_MIN_BODY_LENGTH = 300
JOIN_US_MAX_REGULAR_PER_HOUR = 3

JOIN_US_SUBJECT_LABELS: dict[JoinUsSubject, str] = {
    JoinUsSubject.BETA_TESTER: "Beta Tester",
    JoinUsSubject.FULL_STACK_DEVELOPER: "Full-Stack Developer",
    JoinUsSubject.OTHER: "Other",
}


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


class InvalidCurrentPasswordError(Exception):
    """Raised when the submitted current password does not match."""


class JoinUsCaptchaRequiredError(Exception):
    """Raised when Join Us form submission requires CAPTCHA but none is provided."""


class JoinUsCaptchaVerificationError(Exception):
    """Raised when Join Us CAPTCHA verification fails."""


class JoinUsEmailNotConfiguredError(Exception):
    """Raised when SMTP is not configured for Join Us form delivery."""


class JoinUsEmailDeliveryError(Exception):
    """Raised when Join Us form email delivery fails."""


class JoinUsBodyTooShortError(Exception):
    """Raised when a regular Join Us submission does not meet min body length."""


class JoinUsRateLimitExceededError(Exception):
    """Raised when regular Join Us submissions exceed per-hour IP limit."""

    def __init__(self, retry_after_seconds: int):
        self.retry_after_seconds = retry_after_seconds
        super().__init__("Join Us submission rate limit exceeded")


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

    async def get_user_by_email(self, email: str) -> User | None:
        """Get a user by email address."""
        result = await self.db.execute(select(User).where(User.email == email))
        return result.scalar_one_or_none()

    async def get_user_by_email_case_insensitive(self, email: str) -> User | None:
        """Get a user by email address using case-insensitive comparison."""
        normalized_email = email.strip().lower()
        result = await self.db.execute(
            select(User).where(func.lower(User.email) == normalized_email)
        )
        return result.scalar_one_or_none()

    async def get_user_by_id(self, user_id: int) -> User | None:
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

    async def _send_smtp_message(self, message: EmailMessage) -> None:
        """Send an email message using configured SMTP transport mode."""
        smtp_host = self.settings.smtp_host
        smtp_port = self.settings.smtp_port
        smtp_username = self.settings.smtp_username
        smtp_password = self.settings.smtp_password
        smtp_use_tls = self.settings.smtp_use_tls
        smtp_use_ssl = self.settings.smtp_use_ssl

        def send_blocking() -> None:
            if smtp_use_ssl:
                with smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=10) as smtp:
                    if smtp_username:
                        smtp.login(smtp_username, smtp_password)
                    smtp.send_message(message)
                return

            with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as smtp:
                if smtp_use_tls:
                    smtp.ehlo()
                    smtp.starttls()
                    smtp.ehlo()
                if smtp_username:
                    smtp.login(smtp_username, smtp_password)
                smtp.send_message(message)

        await asyncio.to_thread(send_blocking)

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

        smtp_from_email = self.settings.smtp_from_email

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

        await self._send_smtp_message(message)

    async def _get_subject_counts_for_update(self) -> SubjectCounts:
        """Fetch singleton subject counter row with a write lock."""
        result = await self.db.execute(
            select(SubjectCounts).where(SubjectCounts.id == 1).with_for_update()
        )
        subject_counts = result.scalar_one_or_none()
        if subject_counts is not None:
            return subject_counts

        subject_counts = SubjectCounts(
            id=1,
            beta_tester=0,
            full_stack_developer=0,
            other=0,
        )
        self.db.add(subject_counts)
        await self.db.flush()
        return subject_counts

    async def _reserve_join_us_sequence_number(self, subject: JoinUsSubject) -> int:
        """Increment and persist the per-subject sequence counter."""
        subject_counts = await self._get_subject_counts_for_update()

        if subject == JoinUsSubject.BETA_TESTER:
            subject_counts.beta_tester += 1
            sequence_number = subject_counts.beta_tester
        elif subject == JoinUsSubject.FULL_STACK_DEVELOPER:
            subject_counts.full_stack_developer += 1
            sequence_number = subject_counts.full_stack_developer
        else:
            subject_counts.other += 1
            sequence_number = subject_counts.other

        await self.db.commit()
        return sequence_number

    async def _enforce_join_us_regular_rate_limit(self, remote_ip: str | None) -> None:
        """Allow at most N regular submissions per hour for one IP."""
        if not remote_ip:
            return

        now = datetime.now(UTC)
        window_start = now - timedelta(hours=1)

        in_window = (
            JoinUsContactSubmission.remote_ip == remote_ip,
            JoinUsContactSubmission.submitted_at >= window_start,
        )

        recent_count_result = await self.db.execute(
            select(func.count(JoinUsContactSubmission.id)).where(*in_window)
        )
        recent_count = int(recent_count_result.scalar_one() or 0)
        if recent_count < JOIN_US_MAX_REGULAR_PER_HOUR:
            return

        oldest_in_window_result = await self.db.execute(
            select(JoinUsContactSubmission.submitted_at)
            .where(*in_window)
            .order_by(JoinUsContactSubmission.submitted_at.asc())
            .limit(1)
        )
        oldest_in_window = oldest_in_window_result.scalar_one_or_none()

        retry_after_seconds = 3600
        if oldest_in_window is not None:
            retry_at = oldest_in_window + timedelta(hours=1)
            retry_after_seconds = max(1, int((retry_at - now).total_seconds()))

        raise JoinUsRateLimitExceededError(retry_after_seconds=retry_after_seconds)

    async def _record_join_us_submission(
        self,
        *,
        remote_ip: str | None,
        subject: JoinUsSubject,
    ) -> None:
        """Persist accepted Join Us submissions for anti-spam accounting."""
        if not remote_ip:
            return

        self.db.add(
            JoinUsContactSubmission(
                remote_ip=remote_ip,
                subject=subject.value,
            )
        )
        await self.db.commit()

    @staticmethod
    def _build_join_us_email_subject(
        subject: JoinUsSubject,
        *,
        sequence_number: int,
    ) -> str:
        """Build mailbox subject line for Join Us requests."""
        subject_label = JOIN_US_SUBJECT_LABELS[subject]
        return f"League Analysis {subject_label} #{sequence_number}"

    async def _send_join_us_contact_email(
        self,
        *,
        subject: JoinUsSubject,
        sequence_number: int,
        body: str,
        remote_ip: str | None,
    ) -> str:
        """Deliver a Join Us email and return the final email subject line."""
        if not self._is_smtp_configured():
            raise JoinUsEmailNotConfiguredError

        smtp_from_email = self.settings.smtp_from_email

        subject_line = self._build_join_us_email_subject(
            subject,
            sequence_number=sequence_number,
        )
        subject_label = JOIN_US_SUBJECT_LABELS[subject]
        sequence_label = f"#{sequence_number}"
        message_body = (
            "New Join Us submission\n\n"
            f"Position: {subject_label}\n"
            f"Sequence: {sequence_label}\n"
            f"Submitted At (UTC): {datetime.now(UTC).isoformat()}\n"
            f"Remote IP: {remote_ip or 'unknown'}\n\n"
            "Message:\n"
            f"{body}\n"
        )

        message = EmailMessage()
        message["Subject"] = subject_line
        message["From"] = smtp_from_email
        message["To"] = JOIN_US_CONTACT_RECIPIENT
        message.set_content(message_body)

        try:
            await self._send_smtp_message(message)
        except (smtplib.SMTPException, OSError) as e:
            logger.error("join_us_email_delivery_failed", error=str(e))
            raise JoinUsEmailDeliveryError from e

        return subject_line

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

        await self._enforce_join_us_regular_rate_limit(remote_ip)

        if self.is_captcha_enabled():
            if not captcha_token:
                raise JoinUsCaptchaRequiredError
            captcha_valid = await self.verify_turnstile_token(
                captcha_token,
                remote_ip,
            )
            if not captcha_valid:
                raise JoinUsCaptchaVerificationError

        sequence_number = await self._reserve_join_us_sequence_number(subject)

        subject_line = await self._send_join_us_contact_email(
            subject=subject,
            sequence_number=sequence_number,
            body=normalized_body,
            remote_ip=remote_ip,
        )

        await self._record_join_us_submission(
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
        now = datetime.now(UTC)
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

        now = datetime.now(UTC)
        if user.locked_until > now:
            return

        user.locked_until = None
        user.failed_login_attempts = 0
        user.updated_at = now
        await self.db.commit()

    def create_access_token(
        self,
        user: User,
        expires_delta: timedelta | None = None,
    ) -> tuple[str, datetime, str]:
        """Create a signed JWT access token with token ID for revocation checks."""
        token_id = self._generate_token_id()
        now = datetime.now(UTC)

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
        expires_delta: timedelta | None = None,
    ) -> tuple[str, datetime, str]:
        """Create and persist a refresh token, returning the raw token once."""
        now = datetime.now(UTC)
        refresh_token = secrets.token_urlsafe(64)
        token_id = self._generate_token_id()
        token_hash = self._hash_refresh_token(refresh_token)

        if expires_delta:
            expires_at = now + expires_delta
        else:
            expires_at = now + timedelta(
                days=self.settings.jwt_refresh_token_expire_days
            )

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
    ) -> tuple[User, str, datetime, str, datetime] | None:
        """Rotate refresh token and return new access/refresh pair.

        `None` means the server refused: no such token, reuse, expiry, or an
        unknown user. It must never mean "something went wrong". The router
        answers `None` with 401 INVALID_REFRESH_TOKEN, and the browser is
        required to end the session on that -- so an infrastructure failure
        swallowed into a `None` here is laundered into a refusal that looks
        byte-identical to a real one, and every visitor is signed out for the
        length of a database blip while their refresh row stays live and
        unrevoked. Let those errors raise: a 500 says nothing about the
        session, which is the truth, and the client keeps it.
        """
        token_hash = self._hash_refresh_token(raw_refresh_token)
        result = await self.db.execute(
            select(RefreshToken).where(RefreshToken.token_hash == token_hash)
        )
        token_record = result.scalar_one_or_none()
        if token_record is None:
            return None

        now = datetime.now(UTC)
        if token_record.revoked_at is not None:
            logger.warning(
                "refresh_token_reuse_detected",
                user_id=token_record.user_id,
                token_id=token_record.token_id,
            )
            await self.revoke_all_refresh_tokens_for_user(token_record.user_id)
            return None

        if token_record.expires_at <= now:
            logger.warning(
                "refresh_token_rotation_rejected",
                reason="expired_token",
                user_id=token_record.user_id,
                token_id=token_record.token_id,
            )
            token_record.revoked_at = now
            await self.db.commit()
            return None

        user = await self.get_user_by_id(token_record.user_id)
        if user is None:
            logger.warning(
                "refresh_token_rotation_rejected",
                reason="unknown_user",
                user_id=token_record.user_id,
                token_id=token_record.token_id,
            )
            token_record.revoked_at = now
            await self.db.commit()
            return None

        token_record.revoked_at = now

        new_refresh_token = secrets.token_urlsafe(64)
        new_token_id = self._generate_token_id()
        new_token_hash = self._hash_refresh_token(new_refresh_token)
        refresh_expires_at = now + timedelta(
            days=self.settings.jwt_refresh_token_expire_days
        )

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
        return (
            user,
            access_token,
            access_expires_at,
            new_refresh_token,
            refresh_expires_at,
        )

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

        now = datetime.now(UTC)
        for token in active_tokens:
            token.revoked_at = now

        await self.db.commit()

    async def resolve_user_id_for_refresh_token(
        self,
        raw_refresh_token: str,
    ) -> int | None:
        """Identify the owner of a refresh token without rotating it.

        Logout needs this because it must work when the access token has
        already expired. That is the common case rather than the rare one: the
        access token lives 30 minutes and the refresh token 30 days, so any
        logout after a short idle period has nothing but the refresh cookie
        left to say whose session to end.
        """
        result = await self.db.execute(
            select(RefreshToken).where(
                RefreshToken.token_hash == self._hash_refresh_token(raw_refresh_token),
                # A revoked token must not authorise revoking everything else.
                # Expiry is still allowed through: an old-but-unrevoked token
                # is the ordinary way to log out of a session left idle, which
                # is the case this method exists for.
                #
                # One revoked token is allowed through: one this server rotated
                # out itself. The browser composes a request from the jar as it
                # stands, so a Sign Out clicked while a refresh is in flight --
                # or after a refresh whose response never arrived, or in a
                # second tab -- carries the token the replacement supersedes.
                # Refusing to name its owner there answers "Successfully logged
                # out" having revoked nothing, and the replacement stays live
                # for its full 30 days with no browser left holding it to ever
                # trip reuse detection. That is the state this route exists to
                # remove. It grants nothing new either: replaying the same
                # token at /refresh already revokes the whole family through
                # reuse detection, which is strictly more than this does. A
                # token revoked by a logout or by that reuse path has no
                # replacement recorded, so it still names nobody.
                or_(
                    RefreshToken.revoked_at.is_(None),
                    RefreshToken.replaced_by_token_id.is_not(None),
                ),
            )
        )
        token_record = result.scalar_one_or_none()
        return None if token_record is None else token_record.user_id

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
        except InvalidTokenError:
            logger.debug("access_token_revocation_skipped", reason="invalid_token")
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

        expires_at = datetime.fromtimestamp(exp, tz=UTC)
        if expires_at <= datetime.now(UTC):
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
        try:
            await self.db.commit()
        except IntegrityError:
            # `token_id` is unique and the check above is not atomic, so two
            # logouts carrying the same token -- two tabs, or the context's
            # logout racing the one token-manager sends after a rotation it
            # could not keep -- can both reach this insert. The loser would
            # answer 500 on a route whose whole point is that it always
            # succeeds, and it lost only because the winner already did the
            # work it was asking for.
            await self.db.rollback()

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
    ) -> User | None:
        """Authenticate a user with email and password.

        Uses constant-time comparison to prevent timing attacks that could
        reveal valid email addresses. Always hashes the password even when
        the user doesn't exist.
        """
        user = await self.get_user_by_email_case_insensitive(email)

        # Always hash password to prevent timing attacks
        # If user doesn't exist, hash against a dummy value
        if not user:
            self.verify_password(password, DUMMY_PASSWORD_HASH)
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

        if not self.verify_password(password, user.password_hash):
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
        """Create a new user."""
        # Check if user already exists
        existing_user = await self.get_user_by_email_case_insensitive(user_create.email)
        if existing_user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "EMAIL_ALREADY_REGISTERED",
                    "message": "This email is already registered.",
                },
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

        logger.info("user_registered", user_id=user.id, email=user.email)
        return user

    async def request_email_change_code(
        self,
        *,
        current_user: User,
        new_email: str,
    ) -> datetime:
        """Generate and send a verification code for changing user email."""
        now = datetime.now(UTC)
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

    @staticmethod
    def _raise_if_email_change_locked(
        email_change_request: EmailChangeRequest, now: datetime
    ) -> None:
        """Reject email-change actions while the user is locked out."""
        if (
            email_change_request.locked_until is not None
            and email_change_request.locked_until > now
        ):
            raise EmailChangeLockedError(email_change_request.locked_until)

    @staticmethod
    def _require_pending_email_change(
        email_change_request: EmailChangeRequest,
    ) -> tuple[str, str, datetime]:
        """Return the pending request fields or raise if none is active."""
        pending_email = email_change_request.pending_email
        verification_code_hash = email_change_request.verification_code_hash
        code_expires_at = email_change_request.code_expires_at
        if (
            pending_email is None
            or verification_code_hash is None
            or code_expires_at is None
        ):
            raise EmailVerificationRequestNotFoundError
        return pending_email, verification_code_hash, code_expires_at

    async def _expire_email_change_code_if_needed(
        self,
        email_change_request: EmailChangeRequest,
        code_expires_at: datetime,
        now: datetime,
    ) -> None:
        """Clear an expired code and raise so the user can request a new one."""
        if code_expires_at > now:
            return
        email_change_request.verification_code_hash = None
        email_change_request.code_expires_at = None
        email_change_request.failed_attempts = 0
        email_change_request.updated_at = now
        await self.db.commit()
        raise EmailVerificationCodeExpiredError

    async def _record_failed_email_verification(
        self, email_change_request: EmailChangeRequest, now: datetime
    ) -> NoReturn:
        """Count a wrong code and lock email-change after too many failures."""
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

    async def _apply_verified_email_change(
        self,
        current_user: User,
        email_change_request: EmailChangeRequest,
        pending_email: str,
        now: datetime,
    ) -> User:
        """Persist the verified email and clear the pending request."""
        existing_user = await self.get_user_by_email_case_insensitive(pending_email)
        if existing_user is not None and existing_user.id != current_user.id:
            raise EmailAlreadyRegisteredError

        current_user.email = pending_email
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

    async def verify_email_change_code(
        self,
        *,
        current_user: User,
        code: str,
    ) -> User:
        """Validate the code and update current user's email on success."""
        now = datetime.now(UTC)
        email_change_request = await self._get_or_create_email_change_request(
            current_user.id
        )
        self._raise_if_email_change_locked(email_change_request, now)
        pending_email, verification_code_hash, code_expires_at = (
            self._require_pending_email_change(email_change_request)
        )
        await self._expire_email_change_code_if_needed(
            email_change_request, code_expires_at, now
        )

        submitted_hash = self._hash_email_verification_code(code)
        is_match = secrets.compare_digest(verification_code_hash, submitted_hash)
        if not is_match:
            await self._record_failed_email_verification(email_change_request, now)

        return await self._apply_verified_email_change(
            current_user, email_change_request, pending_email, now
        )

    async def change_password(
        self,
        *,
        current_user: User,
        current_password: str,
        new_password: str,
    ) -> None:
        """Change current user's password hash."""
        if not self.verify_password(current_password, current_user.password_hash):
            raise InvalidCurrentPasswordError

        now = datetime.now(UTC)
        current_user.password_hash = self.get_password_hash(new_password)
        current_user.updated_at = now
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
            user.updated_at = now
            await self.db.commit()

    @staticmethod
    def _unauthenticated_credentials_error() -> HTTPException:
        """Build the standard 401 used for invalid or incomplete access tokens."""
        return HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Your session is invalid or expired. Please sign in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    @staticmethod
    def _access_token_data_from_payload(
        payload: Mapping[str, object],
    ) -> TokenData | None:
        """Return access-token claims when the payload has the required types."""
        email = payload.get("sub")
        user_id = payload.get("user_id")
        token_id = payload.get("jti")
        token_type = payload.get("typ")
        exp = payload.get("exp")

        if (
            not isinstance(email, str)
            or not isinstance(user_id, int)
            or not isinstance(token_id, str)
            or not isinstance(token_type, str)
            or token_type != "access"
            or not isinstance(exp, int)
        ):
            return None

        return TokenData(
            email=email,
            user_id=user_id,
            token_id=token_id,
            token_type=token_type,
            exp=exp,
        )

    async def get_current_user(self, token: str = Depends(oauth2_scheme)) -> User:
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


def get_auth_service(db: AsyncSession = Depends(get_db)) -> AuthService:
    """Dependency to get auth service instance."""
    return AuthService(db)
