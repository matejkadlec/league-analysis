"""Durable health tracking for the effective Riot API credential."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import structlog
from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    ForeignKey,
    Integer,
    String,
    delete,
    select,
)
from sqlalchemy import DateTime as SQLDateTime
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.schema import conv
from sqlalchemy.sql import func

from app.core.models import Base, created_at_column, updated_at_column
from app.core.riot_api.client import RiotAPIClient
from app.core.riot_api.constants import Platform, Region
from app.core.riot_api.credential_vocabulary import (
    RiotCredentialEvidence,
    RiotCredentialStatus,
)
from app.core.runs import values_in_sql

logger = structlog.get_logger(__name__)

_HEALTH_ROW_ID = 1
_DEVELOPMENT_KEY_MAX_AGE = timedelta(hours=24)


class RiotAPIKey(Base):
    """The single stored Riot API credential.

    At most one row exists: saving a key replaces the previous one outright.
    Past keys are secrets with no diagnostic value, so none are retained.
    """

    __tablename__ = "riot_api_keys"
    __table_args__ = (
        # `conv()` keeps the pre-convention name the baseline actually created.
        # A single `%` is correct: SQLAlchemy escapes it for the DBAPI when it
        # compiles the DDL, so spelling `%%` renders as `%%%%`.
        CheckConstraint(
            "key_value LIKE 'RGAPI-%' AND length(key_value) = 42",
            name=conv("check_riot_key_format"),
        ),
        {"schema": "core", "comment": "Storage for Riot API keys"},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key_value: Mapped[str] = mapped_column(
        String(42),
        unique=True,
        nullable=False,
        comment="The actual Riot API key (RGAPI-...) which must be 42 chars",
    )
    added_at: Mapped[datetime] = mapped_column(
        SQLDateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        comment="When this key was added to the system",
    )


class RiotCredentialHealth(Base):
    """Singleton state for the credential the backend is actually using."""

    __tablename__ = "riot_credential_health"
    __table_args__ = (
        CheckConstraint("id = 1", name="singleton_id"),
        CheckConstraint(
            values_in_sql("status", [s.value for s in RiotCredentialStatus]),
            name="valid_status",
        ),
        CheckConstraint(
            values_in_sql("evidence", [e.value for e in RiotCredentialEvidence]),
            name="valid_evidence",
        ),
        CheckConstraint("revision > 0", name="positive_revision"),
        {"schema": "core"},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    generation: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        comment="Random non-secret generation identifier for stale-evidence rejection",
    )
    db_key_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("core.riot_api_keys.id", ondelete="SET NULL"),
        nullable=True,
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    evidence: Mapped[str] = mapped_column(String(32), nullable=False)
    evidence_at: Mapped[datetime] = mapped_column(
        SQLDateTime(timezone=True), nullable=False
    )
    revision: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    recovered_at: Mapped[datetime | None] = mapped_column(
        SQLDateTime(timezone=True), nullable=True
    )
    recovery_revision: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()


@dataclass(frozen=True)
class EffectiveRiotCredential:
    """Secret value plus its safe server-side identity."""

    value: str
    generation: str


@dataclass(frozen=True)
class RiotCredentialHealthSnapshot:
    """Secret-free current configuration and health snapshot."""

    status: RiotCredentialStatus
    evidence: RiotCredentialEvidence
    evidence_at: datetime
    revision: int
    recovered_at: datetime | None
    recovery_revision: int | None


CredentialHealthCallback = Callable[[RiotCredentialStatus, datetime], Awaitable[None]]


async def _lock_newest_key(db: AsyncSession) -> RiotAPIKey | None:
    """Lock and return the newest key row, or None if the table is empty."""
    result = await db.execute(
        select(RiotAPIKey)
        .order_by(RiotAPIKey.added_at.desc())
        .limit(1)
        .with_for_update()
    )
    return result.scalar_one_or_none()


async def _stored_database_key(db: AsyncSession) -> RiotAPIKey | None:
    """Lock and return the stored key, whether or not it is still usable.

    Expiry is decided by the caller: deleting an aged key here would blank
    `riot_credential_health.db_key_id` through its `ON DELETE SET NULL`
    foreign key before the caller could notice the credential had changed.
    """
    key_record = await _lock_newest_key(db)
    if key_record is None:
        # `LIMIT 1 ... FOR UPDATE` picks its row from the statement's own
        # snapshot and only then blocks, so a concurrent save that deleted that
        # row returns nothing -- not its replacement. A second snapshot sees it.
        key_record = await _lock_newest_key(db)
    return key_record


async def _lock_health_row(
    db: AsyncSession,
    *,
    now: datetime,
) -> RiotCredentialHealth:
    """Create and lock the singleton without exposing an identity secret."""
    await db.execute(
        insert(RiotCredentialHealth)
        .values(
            id=_HEALTH_ROW_ID,
            generation=uuid4().hex,
            db_key_id=None,
            status=RiotCredentialStatus.MISSING.value,
            evidence=RiotCredentialEvidence.MISSING.value,
            evidence_at=now,
            revision=1,
        )
        .on_conflict_do_nothing(index_elements=[RiotCredentialHealth.id])
    )
    result = await db.execute(
        select(RiotCredentialHealth)
        .where(RiotCredentialHealth.id == _HEALTH_ROW_ID)
        .with_for_update()
    )
    return result.scalar_one()


def _snapshot(health: RiotCredentialHealth) -> RiotCredentialHealthSnapshot:
    return RiotCredentialHealthSnapshot(
        status=RiotCredentialStatus(health.status),
        evidence=RiotCredentialEvidence(health.evidence),
        evidence_at=health.evidence_at,
        revision=health.revision,
        recovered_at=health.recovered_at,
        recovery_revision=health.recovery_revision,
    )


def _replace_generation(
    health: RiotCredentialHealth,
    *,
    db_key_id: int | None,
    now: datetime,
) -> None:
    """Reset stale evidence when the effective credential identity changes."""
    missing = db_key_id is None
    health.generation = uuid4().hex
    health.db_key_id = db_key_id
    health.status = (
        RiotCredentialStatus.MISSING.value
        if missing
        else RiotCredentialStatus.UNKNOWN.value
    )
    health.evidence = (
        RiotCredentialEvidence.MISSING.value
        if missing
        else RiotCredentialEvidence.CONFIGURED.value
    )
    health.evidence_at = now
    health.revision += 1
    health.recovered_at = None
    health.recovery_revision = None


async def synchronize_riot_credential_health(
    db: AsyncSession,
) -> tuple[EffectiveRiotCredential | None, RiotCredentialHealthSnapshot]:
    """Resolve precedence and durably align health with the effective credential.

    This commits only credential selection/health changes and must be called
    before the caller begins domain writes.
    """
    now = datetime.now(UTC)
    key_record = await _stored_database_key(db)
    expired = (
        key_record is not None and now - key_record.added_at > _DEVELOPMENT_KEY_MAX_AGE
    )
    db_key = None if expired else key_record

    health = await _lock_health_row(db, now=now)
    db_key_id = db_key.id if db_key is not None else None
    if health.db_key_id != db_key_id:
        _replace_generation(health, db_key_id=db_key_id, now=now)

    if expired and key_record is not None:
        # Deleting earlier would blank `db_key_id` through `ON DELETE SET NULL`,
        # leaving health reading `valid` for a dead credential. Taking no new
        # lock here keeps the save path's order, so they cannot deadlock.
        logger.warning("riot_api_key_age_limit_reached", key_id=key_record.id)
        await db.execute(delete(RiotAPIKey).where(RiotAPIKey.id == key_record.id))

    await db.commit()
    snapshot = _snapshot(health)
    credential = (
        EffectiveRiotCredential(
            value=db_key.key_value,
            generation=health.generation,
        )
        if db_key is not None
        else None
    )
    return credential, snapshot


async def mark_database_credential_valid(
    db: AsyncSession,
    key_record: RiotAPIKey,
    *,
    evidence_at: datetime,
) -> None:
    """Atomically bind a validated saved key to a fresh/current generation."""
    await db.flush()
    health = await _lock_health_row(db, now=evidence_at)
    previous_status = RiotCredentialStatus(health.status)
    identity_changed = health.db_key_id != key_record.id
    if identity_changed:
        _replace_generation(health, db_key_id=key_record.id, now=evidence_at)

    next_revision = health.revision + int(
        not identity_changed and previous_status is not RiotCredentialStatus.VALID
    )
    health.status = RiotCredentialStatus.VALID.value
    health.evidence = RiotCredentialEvidence.SETTINGS_VALIDATION.value
    health.evidence_at = evidence_at
    health.revision = next_revision
    if previous_status in {
        RiotCredentialStatus.INVALID,
        RiotCredentialStatus.MISSING,
    }:
        health.recovered_at = evidence_at
        health.recovery_revision = next_revision


async def record_riot_credential_evidence(
    generation: str,
    status: RiotCredentialStatus,
    evidence_at: datetime,
) -> None:
    """Persist ordered provider evidence only for the current generation."""
    if status not in {RiotCredentialStatus.VALID, RiotCredentialStatus.INVALID}:
        return

    from app.core.database import db_manager

    async with db_manager.get_session() as db:
        result = await db.execute(
            select(RiotCredentialHealth)
            .where(RiotCredentialHealth.id == _HEALTH_ROW_ID)
            .with_for_update()
        )
        health = result.scalar_one_or_none()
        if health is not None and apply_riot_credential_evidence(
            health,
            generation=generation,
            status=status,
            evidence_at=evidence_at,
        ):
            await db.commit()


def apply_riot_credential_evidence(
    health: RiotCredentialHealth,
    *,
    generation: str,
    status: RiotCredentialStatus,
    evidence_at: datetime,
) -> bool:
    """Apply ordered evidence to a locked health row, returning whether it won."""
    if status not in {RiotCredentialStatus.VALID, RiotCredentialStatus.INVALID}:
        return False
    if health.generation != generation or health.evidence_at > evidence_at:
        return False

    previous_status = RiotCredentialStatus(health.status)
    state_changed = previous_status is not status
    next_revision = health.revision + int(state_changed)
    health.status = status.value
    health.evidence = (
        RiotCredentialEvidence.PROVIDER_SUCCESS.value
        if status is RiotCredentialStatus.VALID
        else RiotCredentialEvidence.CREDENTIAL_REJECTED.value
    )
    health.evidence_at = evidence_at
    health.revision = next_revision
    if status is RiotCredentialStatus.VALID and previous_status in {
        RiotCredentialStatus.INVALID,
        RiotCredentialStatus.MISSING,
    }:
        health.recovered_at = evidence_at
        health.recovery_revision = next_revision
    return True


def credential_health_callback(generation: str) -> CredentialHealthCallback:
    """Create a callback that rejects evidence from stale credential clients."""

    async def record(status: RiotCredentialStatus, evidence_at: datetime) -> None:
        try:
            await record_riot_credential_evidence(generation, status, evidence_at)
        except Exception as error:
            logger.error(
                "riot_credential_health_record_failed",
                error_type=type(error).__name__,
            )

    return record


async def create_tracked_riot_api_client(
    db: AsyncSession,
    *,
    region: Region | None = None,
    platform: Platform | None = None,
    request_callback: Callable[[str, int], None] | None = None,
) -> RiotAPIClient:
    """Build a client bound to the current durable credential generation."""
    credential, _snapshot_value = await synchronize_riot_credential_health(db)
    if credential is None:
        raise ValueError("No active Riot API key configured")
    return RiotAPIClient(
        api_key=credential.value,
        region=region,
        platform=platform,
        request_callback=request_callback,
        credential_health_callback=credential_health_callback(credential.generation),
    )


__all__ = [
    "EffectiveRiotCredential",
    "RiotAPIKey",
    "RiotCredentialEvidence",
    "RiotCredentialHealth",
    "RiotCredentialHealthSnapshot",
    "RiotCredentialStatus",
    "apply_riot_credential_evidence",
    "create_tracked_riot_api_client",
    "mark_database_credential_valid",
    "record_riot_credential_evidence",
    "synchronize_riot_credential_health",
]
