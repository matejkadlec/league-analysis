"""The token lifecycle: minting, rotation, revocation, and identity.

Access JWTs and refresh-token families, including the reuse alarm and the
logout stamp taken under the owner's lock. `AuthService` composes the mixin;
`_TokenLifecycleHost` declares the plumbing it leans on.
"""

import hashlib
import secrets
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from typing import NamedTuple, Protocol
from uuid import uuid4

import jwt
import structlog
from jwt import InvalidTokenError
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.features.auth.schemas import TokenData
from app.features.auth.users.models import User

from .refresh_token import RefreshToken
from .revoked_access_token import RevokedAccessToken

logger = structlog.get_logger(__name__)


class TokenPair(NamedTuple):
    """One minted access/refresh pair with the instant each expires at."""

    access_token: str
    access_expires_at: datetime
    refresh_token: str
    refresh_expires_at: datetime


class RefreshRotation(NamedTuple):
    """The owner a rotation authenticated, plus the fresh pair it issued."""

    user: User
    pair: TokenPair


class _TokenLifecycleHost(Protocol):
    """The user-row surface the token policy needs from its composing service."""

    db: AsyncSession
    settings: Settings

    async def get_user_by_id(self, user_id: int) -> User | None:
        """The owner of a token family; provided by the composing service."""
        ...


class TokenLifecycleMixin(_TokenLifecycleHost):
    """The shared token lifecycle policy, composed onto the service."""

    @staticmethod
    def _hash_refresh_token(raw_token: str) -> str:
        """Hash refresh token before storing in database."""
        return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()

    @staticmethod
    def _generate_token_id() -> str:
        """Generate a unique token identifier (jti)."""
        return str(uuid4())

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
        insert its replacement in one transaction; calling `create_refresh_token`
        would split it, leaving the caller revoked with no replacement written.
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
        await self._lock_token_family(user_id)
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
    ) -> TokenPair:
        """Issue a fresh access/refresh token pair for a user."""
        access_token, access_expires_at, _ = self.create_access_token(user)
        refresh_token, refresh_expires_at, _ = await self.create_refresh_token(
            user_id=user.id,
            remote_ip=remote_ip,
            user_agent=user_agent,
        )
        return TokenPair(
            access_token=access_token,
            access_expires_at=access_expires_at,
            refresh_token=refresh_token,
            refresh_expires_at=refresh_expires_at,
        )

    async def rotate_refresh_token(
        self,
        raw_refresh_token: str,
        remote_ip: str | None = None,
        user_agent: str | None = None,
    ) -> RefreshRotation | None:
        """Rotate refresh token and return the owner with a new token pair.

        `None` means the server refused: no such token, reuse, expiry, or an
        unknown user, never "something went wrong". The router answers `None`
        with 401 and the browser ends the session, so let real errors raise.
        """
        token_hash = self._hash_refresh_token(raw_refresh_token)
        # The owner first, and before the row below: a logout takes the same
        # lock, and two writers taking them in opposite orders deadlock.
        owner_id = await self.db.scalar(
            select(RefreshToken.user_id).where(RefreshToken.token_hash == token_hash)
        )
        if owner_id is None:
            return None
        await self._lock_token_family(owner_id)

        # `FOR UPDATE`: this reads `revoked_at` and then writes it, so two
        # requests carrying one cookie both read NULL and both rotate, forking
        # one token into two valid families with the reuse alarm skipped.
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
        return RefreshRotation(
            user=user,
            pair=TokenPair(
                access_token=access_token,
                access_expires_at=access_expires_at,
                refresh_token=new_refresh_token,
                refresh_expires_at=refresh_expires_at,
            ),
        )

    async def _get_refresh_token_by_token_id(
        self, token_id: str
    ) -> RefreshToken | None:
        result = await self.db.execute(
            select(RefreshToken).where(RefreshToken.token_id == token_id)
        )
        return result.scalar_one_or_none()

    async def _lock_refresh_token_by_token_id(
        self, token_id: str
    ) -> RefreshToken | None:
        result = await self.db.execute(
            select(RefreshToken)
            .where(RefreshToken.token_id == token_id)
            .with_for_update()
        )
        return result.scalar_one_or_none()

    async def _lock_token_family(self, user_id: int) -> None:
        """Serialise everyone who writes one user's refresh tokens.

        Logout stamps the whole set in one statement, and a row committed
        after that statement began is below its snapshot however it waited.
        Taking the owner first is what stops a rotation inserting under it.
        """
        await self.db.execute(
            select(User.id).where(User.id == user_id).with_for_update()
        )

    @staticmethod
    def _successor_is_unused(successor: RefreshToken) -> bool:
        """Nothing has been done with the replacement since it was issued."""
        return successor.revoked_at is None and successor.replaced_by_token_id is None

    @classmethod
    def _reuse_is_healable(
        cls,
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
            cls._successor_is_unused(successor)
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
    ) -> RefreshRotation | None:
        """Decide what a request presenting an already-revoked token gets.

        Heal when the presented token is unexpired and its replacement was
        never used: revoke that replacement, mint a fresh one, answer success.
        Otherwise revoke only the presented token's descendants, and refuse.
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
                return RefreshRotation(
                    user=user,
                    pair=TokenPair(
                        access_token=access_token,
                        access_expires_at=access_expires_at,
                        refresh_token=new_refresh_token,
                        refresh_expires_at=refresh_expires_at,
                    ),
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
        """Revoke every refresh token a user holds, under the owner's lock.

        Without the lock a rotation commits a replacement this statement's
        snapshot cannot see, and logout answers "Successfully logged out"
        with that fresh token live.
        """
        await self._lock_token_family(user_id)
        await self.db.execute(
            update(RefreshToken)
            .where(
                RefreshToken.user_id == user_id,
                RefreshToken.revoked_at.is_(None),
            )
            .values(revoked_at=datetime.now(UTC))
            # Nobody reads these objects again, so there is nothing for the
            # ORM to synchronize.
            .execution_options(synchronize_session=False)
        )
        await self.db.commit()

    async def resolve_user_id_for_refresh_token(
        self,
        raw_refresh_token: str,
    ) -> int | None:
        """Identify the owner of a refresh token without rotating it.

        Logout needs this because it must work when the access token has
        already expired -- the common case, since access lives 30 minutes and
        the refresh cookie 30 days.
        """
        result = await self.db.execute(
            select(RefreshToken).where(
                RefreshToken.token_hash == self._hash_refresh_token(raw_refresh_token),
            )
        )
        token_record = result.scalar_one_or_none()
        if token_record is None:
            return None
        # An expired cookie carries no session, so there is nothing here for
        # it to end -- and honouring one would let a stale copy revoke every
        # device its owner still holds.
        now = datetime.now(UTC)
        if token_record.expires_at <= now:
            return None
        if token_record.revoked_at is None:
            return token_record.user_id

        # A revoked token authorises this only in the case the route exists
        # for: the Sign Out that raced the refresh superseding it, so the
        # replacement is the one this server has just issued and nobody used.
        if token_record.replaced_by_token_id is None:
            return None
        successor = await self._get_refresh_token_by_token_id(
            token_record.replaced_by_token_id
        )
        if successor is None or not self._reuse_is_healable(
            token_record, successor, now
        ):
            return None
        return token_record.user_id

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
        # logout racing the one token-manager sends after a rotation. `token_id`
        # is unique, so let the database settle it.
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
