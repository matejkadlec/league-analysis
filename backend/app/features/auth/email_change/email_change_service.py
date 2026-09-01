"""The email-change orchestration: request a code, verify it, apply it.

`AuthService` composes the mixin; `_EmailChangeHost` declares the user-row
surface it leans on.
"""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from typing import NoReturn, Protocol

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.auth.errors import (
    EmailAlreadyRegisteredError,
    EmailChangeEmailNotConfiguredError,
    EmailChangeLockedError,
    EmailUnchangedError,
    EmailVerificationCodeExpiredError,
    EmailVerificationRequestNotFoundError,
    InvalidEmailVerificationCodeError,
)
from app.features.auth.mailer import send_smtp_message, smtp_configured
from app.features.auth.schemas import EMAIL_CHANGE_CODE_LENGTH
from app.features.auth.users.models import User

from .email_change_request import EmailChangeRequest

logger = structlog.get_logger(__name__)

EMAIL_CHANGE_CODE_EXPIRY_MINUTES = 10
EMAIL_CHANGE_MAX_FAILED_ATTEMPTS = 3
EMAIL_CHANGE_LOCK_MINUTES = 5


class _EmailChangeHost(Protocol):
    """The user-row surface the email-change policy needs from its host."""

    db: AsyncSession

    async def get_user_by_email_case_insensitive(self, email: str) -> User | None:
        """The registered owner of an email, if any; provided by the host."""
        ...


class EmailChangeMixin(_EmailChangeHost):
    """The shared email-change policy, composed onto the service."""

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
    def _hash_email_verification_code(raw_code: str) -> str:
        """Hash email verification code before storing it."""
        return hashlib.sha256(raw_code.encode("utf-8")).hexdigest()

    @staticmethod
    def _generate_email_verification_code() -> str:
        """Generate random 6-digit numeric verification code."""
        return f"{secrets.randbelow(10**EMAIL_CHANGE_CODE_LENGTH):0{EMAIL_CHANGE_CODE_LENGTH}d}"

    async def _send_email_verification_code(
        self,
        *,
        target_email: str,
        code: str,
    ) -> None:
        """Send email-change verification code."""
        # Refuse rather than log the code: an unconfigured deployment must not
        # look like a working one, with the code left on disk.
        if not smtp_configured():
            raise EmailChangeEmailNotConfiguredError

        subject = "League Analysis - Verify Your New Email"
        body = (
            "Your verification code is: "
            f"{code}\n\n"
            f"This code expires in {EMAIL_CHANGE_CODE_EXPIRY_MINUTES} minutes.\n"
            "If you did not request this change, you can safely ignore this email."
        )

        message = EmailMessage()
        message["Subject"] = subject
        message["To"] = target_email
        message.set_content(body)

        await send_smtp_message(message)

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

        email_change_request.pending_email = None
        email_change_request.verification_code_hash = None
        email_change_request.code_expires_at = None
        email_change_request.failed_attempts = 0
        email_change_request.locked_until = None

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
