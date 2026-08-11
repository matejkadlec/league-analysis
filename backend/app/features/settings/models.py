"""Models for system and viewer-owned settings."""

from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    String,
)
from sqlalchemy import (
    DateTime as SQLDateTime,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.models import Base
from app.core.riot_api.credential_health import RiotAPIKey as RiotAPIKey


class UserCardPreference(Base):
    """Versioned, viewer-owned overrides for an approved analytical card."""

    __tablename__ = "user_card_preferences"
    __table_args__ = (
        CheckConstraint("version > 0", name="positive_version"),
        Index("ix_user_card_preferences_user_updated", "user_id", "updated_at"),
        {"schema": "auth"},
    )

    user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("auth.users.id", ondelete="CASCADE"),
        primary_key=True,
        comment="Authenticated viewer that owns this preference",
    )
    card_id: Mapped[str] = mapped_column(
        String(64),
        primary_key=True,
        comment="Stable card catalog identifier",
    )
    version: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        comment="Version of the card-specific settings contract",
    )
    settings: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        comment="Validated mutable settings only; fixed defaults are normalized on read",
    )
    created_at: Mapped[datetime] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        comment="When this versioned override was first stored",
    )
    updated_at: Mapped[datetime] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
        comment="When this versioned override was most recently updated",
    )
