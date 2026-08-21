"""Persisted matchmaking analysis lifecycle and immutable results."""

from datetime import datetime
from typing import TypedDict

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Index,
    PrimaryKeyConstraint,
    String,
    text,
)
from sqlalchemy import (
    DateTime as SQLDateTime,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.models import Base, created_at_column
from app.features.matchmaking_analysis.schemas import MatchmakingAnalysisStatus


class MatchmakingAnalysisResultsJSON(TypedDict, total=False):
    """Shape of the ``results`` JSONB payload written on completion.

    Every key is optional because rows persisted by earlier revisions predate
    later additions, so readers must keep treating each key as possibly absent.
    """

    team_avg_winrate: float
    enemy_avg_winrate: float
    matches_analyzed: int
    players_analyzed: int


class MatchmakingAnalysis(Base):
    """Persisted lifecycle and results for one matchmaking analysis run."""

    __tablename__ = "matchmaking_analyses"

    # Composite primary key
    puuid: Mapped[str] = mapped_column(
        String(78),
        ForeignKey("core.players.puuid", ondelete="CASCADE"),
        nullable=False,
        comment="Player PUUID this analysis is for",
    )

    created_at: Mapped[datetime] = created_at_column("When this analysis was created")

    # Analysis results - stored as JSON for flexibility
    results: Mapped[MatchmakingAnalysisResultsJSON | None] = mapped_column(
        JSONB,
        nullable=True,
        comment="Analysis results as JSON (team/enemy winrates)",
    )

    # Timestamps
    started_at: Mapped[datetime | None] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=True,
        comment="When this analysis was started",
    )

    completed_at: Mapped[datetime | None] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=True,
        comment="When this analysis was completed",
    )

    status: Mapped[MatchmakingAnalysisStatus] = mapped_column(
        String(32),
        nullable=False,
        default="pending",
        server_default="pending",
        comment="Authoritative analysis lifecycle state",
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

    # Progress tracking - which PUUIDs have been analyzed
    puuid_progress: Mapped[dict[str, bool] | None] = mapped_column(
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
    rate_limit_reset_at: Mapped[datetime | None] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=True,
        default=None,
        comment="Timestamp when rate limit resets (NULL = not waiting)",
    )

    __table_args__ = (
        PrimaryKeyConstraint("puuid", "created_at", name="pk_matchmaking_analyses"),
        CheckConstraint(
            "status IN ('pending', 'in_progress', 'waiting_rate_limit', "
            "'completed', 'failed', 'cancelled')",
            name="status_valid",
        ),
        Index(
            "uq_matchmaking_analyses_active_puuid",
            "puuid",
            unique=True,
            postgresql_where=text(
                "status IN ('pending', 'in_progress', 'waiting_rate_limit')"
            ),
        ),
        Index("idx_matchmaking_analyses_puuid", "puuid"),
        Index("ix_matchmaking_analyses_created_at", "created_at"),
        {"schema": "core"},
    )
