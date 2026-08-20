"""Durable health tracking for the effective Riot API credential."""

from __future__ import annotations

import os
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from uuid import uuid4

import structlog
from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    String,
    desc,
    select,
    text,
)
from sqlalchemy import DateTime as SQLDateTime
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.schema import conv
from sqlalchemy.sql import func

from app.core.models import Base
from app.core.riot_api.client import RiotAPIClient
from app.core.riot_api.constants import Platform, Region
from app.core.riot_api.credential_vocabulary import (
    RiotCredentialEvidence,
    RiotCredentialStatus,
)

logger = structlog.get_logger(__name__)

_HEALTH_ROW_ID = 1
_DEVELOPMENT_KEY_MAX_AGE = timedelta(hours=24)
_ENVIRONMENT_VERSION_PATTERN = re.compile(r"^[A-Za-z0-9._-]{1,64}$")

_runtime_environment_identity: tuple[str | None, str] | None = None
_runtime_environment_generation = uuid4().hex


class RiotCredentialSource(StrEnum):
    """Supported effective Riot credential sources."""

    NONE = "none"
    DATABASE = "db"
    ENVIRONMENT = "env"


class RiotAPIKey(Base):
    """Database-stored Riot API credential."""

    __tablename__ = "riot_api_keys"
    __table_args__ = (
        # `conv()` keeps the pre-convention name the baseline actually created;
        # without it the `ck` convention would render
        # `ck_riot_api_keys_check_riot_key_format` and drift from the database.
        # A single `%` is correct here: SQLAlchemy escapes it for the DBAPI when
        # it compiles the DDL, so spelling `%%` renders as `%%%%`.
        CheckConstraint(
            "key_value LIKE 'RGAPI-%' AND length(key_value) = 42",
            name=conv("check_riot_key_format"),
        ),
        # Present in the database since the baseline; declared here so the
        # models stop proposing its removal.
        # `added_at DESC` is part of the index the baseline created; declaring it
        # ascending here would leave two different indexes under one name.
        Index(
            "idx_riot_api_keys_active_added",
            "is_active",
            desc(text("added_at")),
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
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
        comment="Whether this key is currently active and usable",
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
        CheckConstraint("source IN ('none', 'db', 'env')", name="valid_source"),
        CheckConstraint(
            "status IN ('missing', 'unknown', 'valid', 'invalid')",
            name="valid_status",
        ),
        CheckConstraint(
            "evidence IN ('missing', 'configured', 'settings_validation', "
            "'provider_success', 'credential_rejected')",
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
    source: Mapped[str] = mapped_column(String(8), nullable=False)
    db_key_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("core.riot_api_keys.id", ondelete="SET NULL"),
        nullable=True,
    )
    environment_generation: Mapped[str | None] = mapped_column(
        String(72),
        nullable=True,
        comment="Explicit or runtime-random non-secret environment generation",
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
    created_at: Mapped[datetime] = mapped_column(
        SQLDateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


@dataclass(frozen=True)
class EffectiveRiotCredential:
    """Secret value plus its safe server-side identity."""

    value: str
    source: RiotCredentialSource
    generation: str


@dataclass(frozen=True)
class RiotCredentialHealthSnapshot:
    """Secret-free current configuration and health snapshot."""

    has_db_key: bool
    has_env_key: bool
    source: RiotCredentialSource
    status: RiotCredentialStatus
    evidence: RiotCredentialEvidence
    evidence_at: datetime
    revision: int
    recovered_at: datetime | None
    recovery_revision: int | None


CredentialHealthCallback = Callable[[RiotCredentialStatus, datetime], Awaitable[None]]


def _environment_generation(api_key: str) -> str:
    """Return a non-secret identity that changes when an env credential changes."""
    explicit_version = os.getenv("RIOT_API_KEY_VERSION")
    global _runtime_environment_generation, _runtime_environment_identity
    if explicit_version:
        if not _ENVIRONMENT_VERSION_PATTERN.fullmatch(explicit_version):
            raise ValueError(
                "RIOT_API_KEY_VERSION must contain 1-64 letters, numbers, dots, "
                "underscores, or hyphens"
            )
        if explicit_version.startswith("RGAPI-"):
            raise ValueError("RIOT_API_KEY_VERSION must not contain a Riot API key")
        if (
            _runtime_environment_identity is not None
            and _runtime_environment_identity[0] == explicit_version
            and _runtime_environment_identity[1] != api_key
        ):
            raise ValueError(
                "RIOT_API_KEY_VERSION must change when RIOT_API_KEY changes"
            )
        _runtime_environment_identity = (explicit_version, api_key)
        return f"version:{explicit_version}"

    identity = (None, api_key)
    if _runtime_environment_identity != identity:
        _runtime_environment_identity = identity
        _runtime_environment_generation = uuid4().hex
    return f"runtime:{_runtime_environment_generation}"


async def _active_database_key(db: AsyncSession, now: datetime) -> RiotAPIKey | None:
    """Return the newest usable DB key, disabling aged development keys."""
    while True:
        result = await db.execute(
            select(RiotAPIKey)
            .where(RiotAPIKey.is_active.is_(True))
            .order_by(RiotAPIKey.added_at.desc())
            .limit(1)
            .with_for_update()
        )
        key_record = result.scalar_one_or_none()
        if key_record is None:
            return None
        if now - key_record.added_at <= _DEVELOPMENT_KEY_MAX_AGE:
            return key_record

        key_record.is_active = False
        logger.warning(
            "riot_api_key_age_limit_reached",
            key_id=key_record.id,
        )
        await db.flush()


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
            source=RiotCredentialSource.NONE.value,
            db_key_id=None,
            environment_generation=None,
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


def _snapshot(
    health: RiotCredentialHealth,
    *,
    has_db_key: bool,
    has_env_key: bool,
) -> RiotCredentialHealthSnapshot:
    return RiotCredentialHealthSnapshot(
        has_db_key=has_db_key,
        has_env_key=has_env_key,
        source=RiotCredentialSource(health.source),
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
    source: RiotCredentialSource,
    db_key_id: int | None,
    environment_generation: str | None,
    now: datetime,
) -> None:
    """Reset stale evidence when the effective credential identity changes."""
    health.generation = uuid4().hex
    health.source = source.value
    health.db_key_id = db_key_id
    health.environment_generation = environment_generation
    health.status = (
        RiotCredentialStatus.MISSING.value
        if source is RiotCredentialSource.NONE
        else RiotCredentialStatus.UNKNOWN.value
    )
    health.evidence = (
        RiotCredentialEvidence.MISSING.value
        if source is RiotCredentialSource.NONE
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
    db_key = await _active_database_key(db, now)
    env_key = os.getenv("RIOT_API_KEY")
    has_env_key = bool(env_key and env_key.strip())

    source = RiotCredentialSource.NONE
    raw_value: str | None = None
    db_key_id: int | None = None
    environment_generation: str | None = None
    if db_key is not None:
        source = RiotCredentialSource.DATABASE
        raw_value = db_key.key_value
        db_key_id = db_key.id
    elif has_env_key and env_key is not None:
        source = RiotCredentialSource.ENVIRONMENT
        raw_value = env_key
        environment_generation = _environment_generation(env_key)

    health = await _lock_health_row(db, now=now)
    identity_changed = (
        health.source != source.value
        or health.db_key_id != db_key_id
        or health.environment_generation != environment_generation
    )
    if identity_changed:
        _replace_generation(
            health,
            source=source,
            db_key_id=db_key_id,
            environment_generation=environment_generation,
            now=now,
        )

    await db.commit()
    snapshot = _snapshot(
        health,
        has_db_key=db_key is not None,
        has_env_key=has_env_key,
    )
    credential = (
        EffectiveRiotCredential(
            value=raw_value,
            source=source,
            generation=health.generation,
        )
        if raw_value is not None
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
    identity_changed = (
        health.source != RiotCredentialSource.DATABASE.value
        or health.db_key_id != key_record.id
        or health.environment_generation is not None
    )
    if identity_changed:
        _replace_generation(
            health,
            source=RiotCredentialSource.DATABASE,
            db_key_id=key_record.id,
            environment_generation=None,
            now=evidence_at,
        )

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
    "RiotCredentialSource",
    "RiotCredentialStatus",
    "apply_riot_credential_evidence",
    "create_tracked_riot_api_client",
    "mark_database_credential_valid",
    "record_riot_credential_evidence",
    "synchronize_riot_credential_health",
]
