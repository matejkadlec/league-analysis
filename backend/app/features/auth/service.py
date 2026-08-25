"""Authentication service for user management, JWT access tokens, and refresh sessions."""

import hashlib
import secrets
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from typing import Annotated, NoReturn
from uuid import uuid4

import httpx
import jwt
import structlog
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jwt import ExpiredSignatureError, InvalidTokenError
from sqlalchemy import delete, func, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_global_settings
from app.core.database import get_db

from .email_change_request import EmailChangeRequest
from .errors import (
    AccountLockedError,
    CaptchaRequiredError,
    CaptchaVerificationError,
    EmailAlreadyRegisteredError,
    EmailChangeEmailNotConfiguredError,
    EmailChangeLockedError,
    EmailUnchangedError,
    EmailVerificationCodeExpiredError,
    EmailVerificationRequestNotFoundError,
    InvalidCurrentPasswordError,
    InvalidEmailVerificationCodeError,
    JoinUsBodyTooShortError,
    JoinUsCaptchaRequiredError,
    JoinUsCaptchaVerificationError,
)
from .join_us import (
    JOIN_US_CONTACT_RECIPIENT,
    JOIN_US_MIN_BODY_LENGTH,
    enforce_regular_rate_limit,
    record_submission,
    reserve_sequence_number,
    send_contact_email,
)
from .mailer import send_smtp_message, smtp_configured
from .models import User
from .passwords import DUMMY_PASSWORD_HASH, hash_password, verify_password
from .refresh_token import RefreshToken
from .revoked_access_token import RevokedAccessToken
from .schemas import (
    EMAIL_CHANGE_CODE_LENGTH,
    JoinUsSubject,
    TokenData,
    UserCreate,
    UserProfileUpdate,
)

# OAuth2 scheme for token authentication
oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl="/api/v1/auth/login",
    auto_error=False,
)

logger = structlog.get_logger(__name__)

EMAIL_CHANGE_CODE_EXPIRY_MINUTES = 10
EMAIL_CHANGE_MAX_FAILED_ATTEMPTS = 3
EMAIL_CHANGE_LOCK_MINUTES = 5


class AuthService:
    """Service for authentication operations."""

    def __init__(self, db: AsyncSession):
        """Initialize auth service."""
        self.db = db
        self.settings = get_global_settings()

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
        return f"{secrets.randbelow(10**EMAIL_CHANGE_CODE_LENGTH):0{EMAIL_CHANGE_CODE_LENGTH}d}"

    @staticmethod
    def _generate_token_id() -> str:
        """Generate a unique token identifier (jti)."""
        return str(uuid4())

    async def _send_email_verification_code(
        self,
        *,
        target_email: str,
        code: str,
    ) -> None:
        """Send email-change verification code."""
        # Same guard as `join_us.send_contact_email`, and now the same answer.
        # This used to log the code in plaintext and return as if the mail had
        # gone out: the caller then wrote `pending_email` and the hash and
        # committed, so an unconfigured deployment was indistinguishable from a
        # working one -- while `LOG_LEVEL=INFO` and the `local` log driver put
        # the verification code on disk.
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

    def _stage_refresh_token(
        self,
        *,
        user_id: int,
        now: datetime,
        expires_at: datetime,
        remote_ip: str | None,
        user_agent: str | None,
    ) -> tuple[RefreshToken, str]:
        """Stage one `refresh_tokens` row and hand back its raw secret.

        Deliberately does not commit. A rotation has to revoke the old row and
        insert its replacement in a single transaction, so it cannot simply
        call `create_refresh_token`: that would split the rotation in two and
        leave a window with the caller's token revoked and no replacement
        written -- a visitor signed out with nothing to refresh with.
        """
        raw_token = secrets.token_urlsafe(64)
        record = RefreshToken(
            user_id=user_id,
            token_id=self._generate_token_id(),
            token_hash=self._hash_refresh_token(raw_token),
            issued_at=now,
            expires_at=expires_at,
            created_from_ip=remote_ip,
            # `user_agent` is String(255); an untruncated header is a write
            # error, and this is the only place that rule is spelled.
            user_agent=user_agent[:255] if user_agent else None,
        )
        self.db.add(record)
        return record, raw_token

    async def create_refresh_token(
        self,
        user_id: int,
        remote_ip: str | None = None,
        user_agent: str | None = None,
        expires_delta: timedelta | None = None,
    ) -> tuple[str, datetime, str]:
        """Create and persist a refresh token, returning the raw token once."""
        now = datetime.now(UTC)
        expires_at = now + (
            expires_delta or timedelta(days=self.settings.jwt_refresh_token_expire_days)
        )
        record, refresh_token = self._stage_refresh_token(
            user_id=user_id,
            now=now,
            expires_at=expires_at,
            remote_ip=remote_ip,
            user_agent=user_agent,
        )
        # Read before the commit so this does not rely on the session factory's
        # `expire_on_commit=False`; a refreshed attribute here would be a lazy
        # load on an async session.
        token_id = record.token_id
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
        # `FOR UPDATE`: this reads `revoked_at` and then writes it, and two
        # requests carrying one cookie -- two tabs restored together, both
        # 401ing on a 30-minute-old access token -- both used to read NULL and
        # both rotate. That forks one token into two independently valid
        # 30-day families, records only the second replacement, and skips the
        # reuse alarm entirely; an attacker replaying a stolen cookie against
        # a live client got a valid pair with nothing logged and nothing
        # revoked. Serialising the pair sends the loser down the reuse branch,
        # where `_answer_reused_refresh_token` decides between healing an
        # innocent race and revoking a compromised family.
        result = await self.db.execute(
            select(RefreshToken)
            .where(RefreshToken.token_hash == token_hash)
            .with_for_update()
        )
        token_record = result.scalar_one_or_none()
        if token_record is None:
            return None

        now = datetime.now(UTC)
        if token_record.revoked_at is not None:
            return await self._answer_reused_refresh_token(
                token_record,
                now,
                remote_ip=remote_ip,
                user_agent=user_agent,
            )

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

        # No `expires_delta`: a rotation restarts the configured lifetime.
        refresh_expires_at = now + timedelta(
            days=self.settings.jwt_refresh_token_expire_days
        )
        replacement, new_refresh_token = self._stage_refresh_token(
            user_id=user.id,
            now=now,
            expires_at=refresh_expires_at,
            remote_ip=remote_ip,
            user_agent=user_agent,
        )
        token_record.replaced_by_token_id = replacement.token_id
        # One commit: the revocation above, the replaced-by link and the new
        # row land together or not at all.
        await self.db.commit()

        access_token, access_expires_at, _ = self.create_access_token(user)
        return (
            user,
            access_token,
            access_expires_at,
            new_refresh_token,
            refresh_expires_at,
        )

    async def _lock_refresh_token_by_token_id(
        self, token_id: str
    ) -> RefreshToken | None:
        result = await self.db.execute(
            select(RefreshToken)
            .where(RefreshToken.token_id == token_id)
            .with_for_update()
        )
        return result.scalar_one_or_none()

    @staticmethod
    def _reuse_is_healable(
        token_record: RefreshToken,
        successor: RefreshToken,
        now: datetime,
    ) -> bool:
        """A reuse is healable when the replacement was never used.

        The presented credential must be live on its own terms too: an
        expired token is dead however it was revoked, and only survives in
        the table until cleanup deletes it.
        """
        return (
            successor.revoked_at is None
            and successor.replaced_by_token_id is None
            and successor.expires_at > now
            and token_record.expires_at > now
        )

    async def _answer_reused_refresh_token(
        self,
        token_record: RefreshToken,
        now: datetime,
        *,
        remote_ip: str | None,
        user_agent: str | None,
    ) -> tuple[User, str, datetime, str, datetime] | None:
        """Decide what a request presenting an already-revoked token gets.

        Production data (2026-08-25) showed every firing of the old response
        -- revoke every session the user has -- was an innocent client, not an
        attacker: two tabs refreshing one cookie 138ms apart, a browser whose
        rotation response was lost to a deploy, a stale profile reopened with
        a week-old cookie. Each one signed the user out of every device.

        Two-part answer instead:

        - **Heal** when the presented token is itself unexpired and its
          replacement has never been used (unrevoked, unreplaced, unexpired).
          In the innocent races the replacement cookie never reached any
          client, so this holds; an attacker actively riding a stolen chain
          has rotated it, so it does not. Revoke the unused replacement, mint
          a fresh one, answer success. The condition cannot prove the
          replacement was never *delivered*, so two holders of adjacent
          tokens -- a victim and a thief -- could alternate heals and both
          stay in; that needs an already-stolen cookie, and every heal logs,
          so a repeating `refresh_token_reuse_healed` for one user is the
          signal theft detection turned into.

        - **Otherwise revoke the presented token's descendants** -- the chain
          `replaced_by_token_id` records -- and refuse. Theft response is
          preserved: the stolen chain dies the moment the victim's stale
          token collides with it. What changed is blast radius: sessions from
          *other* logins (other devices) survive, so one zombie cookie no
          longer signs the user out everywhere.

        Three-plus concurrent refreshes on one cookie can still walk past the
        heal (the second racer replaces the replacement) and sign that one
        browser out; that is one re-login on one device, accepted.
        """
        successor = None
        if token_record.replaced_by_token_id is not None:
            successor = await self._lock_refresh_token_by_token_id(
                token_record.replaced_by_token_id
            )

        if successor is not None and self._reuse_is_healable(
            token_record, successor, now
        ):
            user = await self.get_user_by_id(token_record.user_id)
            if user is not None:
                successor.revoked_at = now
                refresh_expires_at = now + timedelta(
                    days=self.settings.jwt_refresh_token_expire_days
                )
                replacement, new_refresh_token = self._stage_refresh_token(
                    user_id=user.id,
                    now=now,
                    expires_at=refresh_expires_at,
                    remote_ip=remote_ip,
                    user_agent=user_agent,
                )
                successor.replaced_by_token_id = replacement.token_id
                logger.info(
                    "refresh_token_reuse_healed",
                    user_id=user.id,
                    token_id=token_record.token_id,
                    successor_token_id=successor.token_id,
                )
                await self.db.commit()
                access_token, access_expires_at, _ = self.create_access_token(user)
                return (
                    user,
                    access_token,
                    access_expires_at,
                    new_refresh_token,
                    refresh_expires_at,
                )

        descendants_revoked = 0
        current = successor
        while current is not None:
            if current.revoked_at is None:
                current.revoked_at = now
                descendants_revoked += 1
            next_id = current.replaced_by_token_id
            current = (
                await self._lock_refresh_token_by_token_id(next_id)
                if next_id is not None
                else None
            )
        logger.warning(
            "refresh_token_reuse_detected",
            user_id=token_record.user_id,
            token_id=token_record.token_id,
            descendants_revoked=descendants_revoked,
        )
        await self.db.commit()
        return None

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
                # remove. What it grants is small and holder-scoped: replaying
                # the same token at /refresh already kills its whole descendant
                # chain through reuse detection, so honouring it here extends
                # that to the user's other sessions only for a logout the
                # holder of a just-superseded cookie asked for. A token revoked
                # by a logout or by the reuse path's descendant walk has no
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

        # Two logouts can carry the same token -- two tabs, or the context's
        # logout racing the one token-manager sends after a rotation it could
        # not keep. `token_id` is unique, so let the database settle it: the
        # loser is asking for work the winner already did, and this route's
        # whole point is that it always succeeds.
        await self.db.execute(
            insert(RevokedAccessToken)
            .values(
                user_id=user_id,
                token_id=token_id,
                expires_at=expires_at,
                reason=reason,
            )
            .on_conflict_do_nothing(index_elements=[RevokedAccessToken.token_id])
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

    # Not a FastAPI dependency: `dependencies.get_current_user` is, and it
    # passes the token in. The `Depends(oauth2_scheme)` default this used to
    # carry was never resolved by anything.
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


def get_auth_service(db: Annotated[AsyncSession, Depends(get_db)]) -> AuthService:
    """Dependency to get auth service instance."""
    return AuthService(db)
