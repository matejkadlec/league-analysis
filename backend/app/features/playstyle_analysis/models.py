"""Playstyle analysis model for storing analysis results."""

from datetime import datetime
from enum import Enum as PyEnum
from typing import Any, Final

from sqlalchemy import (
    BigInteger,
    Enum,
    ForeignKey,
    String,
)
from sqlalchemy import (
    DateTime as SQLDateTime,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.models import Base


class AnalysisStatus(str, PyEnum):
    """Status of the playstyle analysis."""

    PENDING = "PENDING"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


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
        comment="Current status of the analysis",
    )

    # Analysis Results
    tags: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        server_default="{}",
        comment="Detected playstyle tags (key=tag_code, value=details)",
    )

    summary_stats: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        server_default="{}",
        comment="Summary statistics calculated during analysis",
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        comment="Analysis creation time",
    )

    updated_at: Mapped[datetime] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
        comment="Last update time",
    )

    # Relationship to Player
    player = relationship("Player", back_populates="playstyle_analysis")
