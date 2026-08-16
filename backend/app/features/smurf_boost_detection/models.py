"""Persistence for smurf and boost detection runs."""

from __future__ import annotations

from datetime import datetime
from typing import Any, override

from sqlalchemy import (
    CheckConstraint,
    Index,
    Integer,
    PrimaryKeyConstraint,
    String,
    text,
)
from sqlalchemy import (
    DateTime as SQLDateTime,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.models import Base


class SmurfBoostAnalysis(Base):
    """Persisted lifecycle and explained result for one detection run."""

    __tablename__ = "smurf_boost_analyses"

    puuid: Mapped[str] = mapped_column(
        String(78),
        nullable=False,
        comment="Player PUUID this analysis is for",
    )

    created_at: Mapped[datetime] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        comment="When this analysis run was created",
    )

    status: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default="pending",
        server_default="pending",
        comment="Authoritative run lifecycle state",
    )

    model_version: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        comment="Detection model version that produced this row",
    )

    thresholds: Mapped[dict[str, float]] = mapped_column(
        JSONB,
        nullable=False,
        comment="Exact threshold set the run was computed with",
    )

    results: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB,
        nullable=True,
        comment="Explained per-family bands, signals, confidence and notes",
    )

    eligible_games: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
        comment="Eligible ranked games available when the run executed",
    )

    latest_match_id: Mapped[str | None] = mapped_column(
        String(32),
        nullable=True,
        comment="Newest eligible match the run considered, for staleness checks",
    )

    error_code: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
        comment="Stable client-safe failure classification",
    )

    error_message: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
        comment="Reviewed user-safe terminal failure message",
    )

    completed_at: Mapped[datetime | None] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=True,
        comment="When the run reached a terminal state",
    )

    __table_args__ = (
        PrimaryKeyConstraint("puuid", "created_at", name="pk_smurf_boost_analyses"),
        CheckConstraint(
            "status IN ('pending', 'in_progress', 'completed', 'failed')",
            name="status_valid",
        ),
        Index(
            "uq_smurf_boost_analyses_active_puuid",
            "puuid",
            unique=True,
            postgresql_where=text("status IN ('pending', 'in_progress')"),
        ),
        # The primary key already covers (puuid, created_at), so the
        # newest-run lookup needs no second index.
        {"schema": "core"},
    )

    @override
    def __repr__(self) -> str:
        """String representation of the analysis run."""
        return (
            f"<SmurfBoostAnalysis(puuid={self.puuid}, "
            f"created_at={self.created_at}, status={self.status})>"
        )
