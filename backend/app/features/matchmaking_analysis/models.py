"""Matchmaking analysis model for immutable analysis results."""

from datetime import datetime
from typing import Optional

from sqlalchemy import (
    DateTime as SQLDateTime,
)
from sqlalchemy import (
    Index,
    PrimaryKeyConstraint,
    String,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.models import Base


class MatchmakingAnalysis(Base):
    """Matchmaking analysis model - immutable records for each analysis.

    This table uses an insert-only pattern:
    - New analysis creates a new row
    - puuid_progress is updated as players are analyzed
    - Once completed, the row is never modified again
    """

    __tablename__ = "matchmaking_analyses"

    # Composite primary key
    puuid: Mapped[str] = mapped_column(
        String(78),
        nullable=False,
        comment="Player PUUID this analysis is for",
    )

    created_at: Mapped[datetime] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        comment="When this analysis was created",
    )

    # Analysis results - stored as JSON for flexibility
    results: Mapped[Optional[dict]] = mapped_column(
        JSONB,
        nullable=True,
        comment="Analysis results as JSON (team/enemy winrates)",
    )

    # Timestamps
    started_at: Mapped[Optional[datetime]] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=True,
        comment="When this analysis was started",
    )

    completed_at: Mapped[Optional[datetime]] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=True,
        comment="When this analysis was completed",
    )

    # Progress tracking - which PUUIDs have been analyzed
    puuid_progress: Mapped[Optional[dict]] = mapped_column(
        JSONB,
        nullable=True,
        default=dict,
        comment="Tracks analyzed PUUIDs: {puuid: true/false}",
    )

    # Number of API requests saved due to cached match data
    requests_saved: Mapped[int] = mapped_column(
        nullable=False,
        default=0,
        comment="Count of API requests saved from cached matches",
    )

    # Rate limit wait tracking - timestamp when rate limit resets (NULL = not waiting)
    rate_limit_reset_at: Mapped[Optional[datetime]] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=True,
        default=None,
        comment="Timestamp when rate limit resets (NULL = not waiting)",
    )

    __table_args__ = (
        PrimaryKeyConstraint("puuid", "created_at", name="pk_matchmaking_analyses"),
        Index("idx_matchmaking_analyses_puuid", "puuid"),
        Index("ix_matchmaking_analyses_created_at", "created_at"),
        {"schema": "core"},
    )

    def __repr__(self) -> str:
        """String representation of the analysis."""
        progress_count = len(self.puuid_progress) if self.puuid_progress else 0
        completed_count = sum(1 for v in (self.puuid_progress or {}).values() if v)
        return (
            f"<MatchmakingAnalysis(puuid={self.puuid}, "
            f"created_at={self.created_at}, "
            f"progress={completed_count}/{progress_count})>"
        )

    @property
    def is_completed(self) -> bool:
        """Check if analysis is completed."""
        return self.completed_at is not None

    @property
    def is_in_progress(self) -> bool:
        """Check if analysis is in progress."""
        return self.started_at is not None and self.completed_at is None

    @property
    def progress_percentage(self) -> float:
        """Calculate progress percentage based on analyzed PUUIDs."""
        if not self.puuid_progress:
            return 0.0
        total = len(self.puuid_progress)
        if total == 0:
            return 0.0
        completed = sum(1 for v in self.puuid_progress.values() if v)
        return (completed / total) * 100
