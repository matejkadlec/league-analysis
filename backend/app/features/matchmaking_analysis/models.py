"""Persisted matchmaking analysis lifecycle and immutable results."""

from datetime import datetime
from typing import TypedDict, get_args

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
from app.core.runs import values_in_sql
from app.features.auth.user_reference import user_id_column
from app.features.matchmaking_analysis.schemas import (
    ACTIVE_ANALYSIS_STATUSES,
    MatchmakingAnalysisStatus,
)


class MatchmakingAnalysisResultsJSON(TypedDict):
    """Shape of the ``results`` JSONB payload written on completion.

    The three required keys are required because `_build_completion_results`
    is the only writer of a non-NULL `results` and has emitted all four since
    the initial commit; the legacy fixtures in `validate_migrations.py` carry
    them too. They used to be optional, which meant both readers supplied
    their own `0` for a missing winrate -- a value inside the response
    schema's own `ge=0.0, le=1.0` bound, so nothing could reject it and the
    UI showed "0% average teammate winrate" for a row it could not read.
    """

    team_avg_winrate: float
    enemy_avg_winrate: float
    matches_analyzed: int


class MatchmakingAnalysis(Base):
    """Persisted lifecycle and results for one matchmaking analysis run."""

    __tablename__ = "matchmaking_analyses"

    user_id: Mapped[int] = user_id_column(
        "Account that started this analysis and is the only one it answers to",
        index=True,
    )

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
            values_in_sql("status", get_args(MatchmakingAnalysisStatus)),
            name="status_valid",
        ),
        # Per account, not per player -- see the matching index on
        # `smurf_boost_analyses`. Ownership itself is enforced by the WHERE
        # clauses in the service; this only stops the two accounts from
        # contending for one active row.
        Index(
            "uq_matchmaking_analyses_active_puuid",
            "user_id",
            "puuid",
            unique=True,
            postgresql_where=text(values_in_sql("status", ACTIVE_ANALYSIS_STATUSES)),
        ),
        # No index on `puuid` alone -- it leads the primary key -- and none
        # on `created_at`, which the key does NOT cover: every query that
        # orders by it also filters on `puuid` (service.py:243, 258, 309, 349),
        # so the key serves all four.
        {"schema": "core"},
    )
