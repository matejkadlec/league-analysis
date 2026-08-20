"""Models for system and viewer-owned settings."""

from datetime import datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    Index,
    Integer,
    String,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.models import Base, created_at_column, updated_at_column
from app.core.riot_api.credential_health import RiotAPIKey as RiotAPIKey
from app.features.auth.user_reference import user_id_column


class UserCardPreference(Base):
    """Versioned, viewer-owned overrides for an approved analytical card."""

    __tablename__ = "user_card_preferences"
    __table_args__ = (
        CheckConstraint("version > 0", name="positive_version"),
        Index("ix_user_card_preferences_user_updated", "user_id", "updated_at"),
        {"schema": "auth"},
    )

    user_id: Mapped[int] = user_id_column(
        "Authenticated viewer that owns this preference", primary_key=True
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
    created_at: Mapped[datetime] = created_at_column(
        "When this versioned override was first stored"
    )
    updated_at: Mapped[datetime] = updated_at_column(
        "When this versioned override was most recently updated"
    )
