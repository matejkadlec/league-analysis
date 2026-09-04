"""Playstyle analysis model for storing analysis results."""

from datetime import datetime
from enum import Enum as PyEnum
from typing import Final, Literal, NotRequired, TypedDict

from sqlalchemy import (
    BigInteger,
    Enum,
    ForeignKey,
    String,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.models import (
    ABSENT_AS_NULL_JSONB,
    Base,
    created_at_column,
    updated_at_column,
)


class AnalysisStatus(str, PyEnum):
    """Status of the playstyle analysis."""

    PENDING = "PENDING"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class TagResult(TypedDict):
    """What an evaluator answers with when a tag's criteria are met."""

    threshold_met: bool
    description: str
    value: float
    # Set only by the two evaluators that name the champion or role they
    # matched; every other tag takes its name from `TagConfig`.
    display_name: NotRequired[str]


class DetectedTag(TypedDict):
    """A `TagResult` after the service has filled in what the config knows."""

    threshold_met: bool
    description: str
    value: float
    sentiment: Literal["positive", "negative", "neutral"]
    display_name: str


class SummaryStats(TypedDict):
    """The player-level figures stored beside the tags.

    `main_role` and `most_played_champion` are `None` when no role passed the
    play-rate bar, rather than the string `"None"` they used to carry.
    """

    total_games: int
    total_wins: int
    total_losses: int
    win_rate: float
    recent_win_rate: float
    avg_kills: float
    avg_deaths: float
    avg_assists: float
    main_role: str | None
    main_role_win_rate: float
    avg_kda: float
    most_played_champion: str | None
    most_played_champion_win_rate: float


class PlaystyleAnalysis(Base):
    """Playstyle analysis model storing tags and summary stats."""

    __tablename__ = "playstyle_analyses"
    __table_args__: Final = {"schema": "core"}

    # Primary key
    id: Mapped[int] = mapped_column(
        BigInteger,
        primary_key=True,
        autoincrement=True,
        comment="Auto-incrementing primary key",
    )

    # Foreign key
    puuid: Mapped[str] = mapped_column(
        String(78),
        ForeignKey("core.players.puuid", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
        comment="Reference to the player being analyzed (Riot PUUID)",
    )

    # Status
    status: Mapped[AnalysisStatus] = mapped_column(
        Enum(
            AnalysisStatus, schema="core", name="analysis_status_enum", create_type=True
        ),
        nullable=False,
        default=AnalysisStatus.PENDING,
        index=True,
        comment="Current status of the analysis",
    )

    # Analysis Results
    tags: Mapped[dict[str, DetectedTag]] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        server_default="{}",
        comment="Detected playstyle tags (key=tag_code, value=details)",
    )

    summary_stats: Mapped[SummaryStats | None] = mapped_column(
        ABSENT_AS_NULL_JSONB,
        nullable=True,
        comment="Summary statistics, NULL when the player had no matches",
    )

    # Timestamps
    created_at: Mapped[datetime] = created_at_column("Analysis creation time")

    updated_at: Mapped[datetime] = updated_at_column("Last update time")

    # Relationship to Player
