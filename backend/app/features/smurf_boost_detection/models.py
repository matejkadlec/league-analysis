"""Persistence for smurf and boost detection runs."""

from __future__ import annotations

from datetime import datetime
from typing import Any, get_args

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

from app.core.models import ABSENT_AS_NULL_JSONB, Base, created_at_column
from app.core.runs import values_in_sql
from app.features.auth.users.user_reference import user_id_column
from app.features.smurf_boost_detection.schemas import (
    ACTIVE_STATUSES,
    SmurfBoostStatus,
)


class SmurfBoostAnalysis(Base):
    """Persisted lifecycle and explained result for one detection run."""

    __tablename__ = "smurf_boost_analyses"

    user_id: Mapped[int] = user_id_column(
        "Account that ran this analysis and is the only one shown it",
        index=True,
    )

    puuid: Mapped[str] = mapped_column(
        String(78),
        nullable=False,
        comment="Player PUUID this analysis is for",
    )

    created_at: Mapped[datetime] = created_at_column(
        "When this analysis run was created"
    )

    status: Mapped[SmurfBoostStatus] = mapped_column(
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
        ABSENT_AS_NULL_JSONB,
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
            values_in_sql("status", get_args(SmurfBoostStatus)),
            name="status_valid",
        ),
        # Per account, not per player: a puuid-wide interlock would let one
        # account block another out of a page they share nothing on.
        Index(
            "uq_smurf_boost_analyses_active_puuid",
            "user_id",
            "puuid",
            unique=True,
            postgresql_where=text(values_in_sql("status", ACTIVE_STATUSES)),
        ),
        # The primary key already covers (puuid, created_at), so the
        # newest-run lookup needs no second index.
        {"schema": "core"},
    )
