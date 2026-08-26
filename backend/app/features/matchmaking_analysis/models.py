"""Persisted matchmaking analysis lifecycle and immutable results."""

from datetime import datetime
from typing import NotRequired, TypedDict, get_args

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

from app.core.enums import LobbyTier
from app.core.models import Base, created_at_column
from app.core.runs import values_in_sql
from app.features.auth.user_reference import user_id_column
from app.features.matchmaking_analysis.ranks import PlayerRankJSON
from app.features.matchmaking_analysis.schemas import (
    ACTIVE_ANALYSIS_STATUSES,
    MatchmakingAnalysisStatus,
)


class MatchmakingPerMatchJSON(TypedDict):
    """One spine match in the results JSONB `per_match` list."""

    match_id: str
    duo: bool
    team_avg: float
    enemy_avg: float
    win: NotRequired[bool | None]
    ally_puuids: NotRequired[list[str] | None]
    enemy_puuids: NotRequired[list[str] | None]
    team_kda: NotRequired[float | None]
    enemy_kda: NotRequired[float | None]
    team_kill_participation: NotRequired[float | None]
    enemy_kill_participation: NotRequired[float | None]
    team_damage_share: NotRequired[float | None]
    enemy_damage_share: NotRequired[float | None]


class MatchmakingRankFreshnessJSON(TypedDict):
    """Rank snapshot provenance counts in the results JSONB."""

    period_accurate: int
    current_day: int


class MatchmakingAnalysisResultsJSON(TypedDict):
    """Shape of the ``results`` JSONB payload written on completion.

    The keys are required, not optional: `_build_completion_results` is the
    only writer of a non-NULL `results` and always emits them, and an optional
    winrate let readers substitute a plausible `0` no schema bound could reject.
    """

    team_avg_winrate: float
    enemy_avg_winrate: float
    matches_analyzed: int
    # Rank/duo extension keys. `NotRequired`, never defaulted to 0 by a
    # reader: rows completed before the extension lack them, and a missing
    # value must render as absent, not as Iron IV 0 LP or a 0% figure.
    matches_requested: NotRequired[int]
    spine_matches_found: NotRequired[int]
    ally_avg_rank_value: NotRequired[float | None]
    enemy_avg_rank_value: NotRequired[float | None]
    ally_tier_counts: NotRequired[dict[LobbyTier, int]]
    enemy_tier_counts: NotRequired[dict[LobbyTier, int]]
    per_match: NotRequired[list[MatchmakingPerMatchJSON]]
    player_ranks: NotRequired[dict[str, PlayerRankJSON]]
    rank_freshness: NotRequired[MatchmakingRankFreshnessJSON]


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

    # Run parameters, read back by the resumed worker and the history Type
    # column. The server default is the truthful legacy value: every run
    # persisted before this column was a 10-match latest-window run.
    params: Mapped[dict[str, object]] = mapped_column(
        JSONB,
        nullable=False,
        server_default='{"match_count": 10, "end_date": null}',
        comment="Run parameters as JSON: {match_count, end_date}",
    )

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
        # Per account, not per player -- ownership itself is enforced by the
        # WHERE clauses in the service; this only stops two accounts from
        # contending for one active row.
        Index(
            "uq_matchmaking_analyses_active_puuid",
            "user_id",
            "puuid",
            unique=True,
            postgresql_where=text(values_in_sql("status", ACTIVE_ANALYSIS_STATUSES)),
        ),
        # No index on `puuid` alone -- it leads the primary key -- and none on
        # `created_at`: every query that orders by it also filters on `puuid`,
        # so the primary key serves them.
        {"schema": "core"},
    )
