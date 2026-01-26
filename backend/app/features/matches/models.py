"""Match data model for storing League of Legends match information."""

from datetime import datetime
from typing import Optional

from sqlalchemy import (
    BigInteger,
    DateTime as SQLDateTime,
    Integer,
    String,
    Boolean,
    Index,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.models import Base


class Match(Base):
    """Match model storing League of Legends match data."""

    __tablename__ = "matches"
    __table_args__ = {"schema": "core"}

    # Primary key - match ID from Riot API
    match_id: Mapped[str] = mapped_column(
        String(64),
        primary_key=True,
        index=True,
        comment="Unique match identifier from Riot API",
    )

    # Platform and routing information
    platform: Mapped[str] = mapped_column(
        String(8),
        nullable=False,
        index=True,
        comment="Platform where the match was played (e.g., EUW1, EUN1)",
    )

    # Game information
    game_start_timestamp: Mapped[int] = mapped_column(
        BigInteger,
        nullable=False,
        index=True,
        comment="Game creation timestamp in milliseconds since epoch",
    )

    game_end_timestamp: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        nullable=True,
        comment="Game end timestamp in milliseconds since epoch",
    )

    game_duration: Mapped[int] = mapped_column(
        Integer, nullable=False, comment="Game duration in seconds"
    )

    queue_id: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        index=True,
        comment="Queue type ID (e.g., 420=Ranked Solo, 440=Ranked Flex)",
    )

    game_version: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        index=True,
        comment="Game version (e.g., '14.20.555.5555')",
    )

    map_id: Mapped[int] = mapped_column(
        Integer, nullable=False, comment="Map ID (e.g., 11=Summoner's Rift)"
    )

    # Game mode information
    game_mode: Mapped[Optional[str]] = mapped_column(
        String(32),
        nullable=True,
        index=True,
        comment="Game mode (e.g., 'CLASSIC', 'ARAM')",
    )

    game_type: Mapped[Optional[str]] = mapped_column(
        String(32),
        nullable=True,
        index=True,
        comment="Game type (e.g., 'MATCHED_GAME')",
    )

    # Match result
    early_surrender: Mapped[Optional[bool]] = mapped_column(
        Boolean,
        nullable=True,
        comment="Whether the game ended in early surrender",
    )

    surrender: Mapped[Optional[bool]] = mapped_column(
        Boolean,
        nullable=True,
        comment="Whether the game ended in surrender",
    )

    game_result: Mapped[Optional[str]] = mapped_column(
        String(32),
        nullable=True,
        comment="End of game result",
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        comment="When this match record was created in our database",
    )

    updated_at: Mapped[datetime] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
        comment="When this match record was last updated",
    )

    # Processing flags
    fully_analyzed: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        index=True,
        comment="Whether this match has been processed for player analysis",
    )

    processing_error: Mapped[Optional[str]] = mapped_column(
        String(256), nullable=True, comment="Error message if match processing failed"
    )

    # Relationships
    participants = relationship(
        "MatchParticipant", back_populates="match", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        """Return string representation of the match."""
        return f"<Match(match_id='{self.match_id}', queue_id={self.queue_id}, game_start_timestamp={self.game_start_timestamp})>"


# Create indexes for common queries
Index("idx_matches_platform_timestamp", Match.platform, Match.game_start_timestamp)

Index("idx_matches_queue_timestamp", Match.queue_id, Match.game_start_timestamp)

Index("idx_matches_version_timestamp", Match.game_version, Match.game_start_timestamp)

Index("idx_matches_analyzed_error", Match.fully_analyzed, Match.processing_error)

# Additional performance indexes for common query patterns
Index("idx_matches_timestamp_queue", Match.game_start_timestamp, Match.queue_id)

Index(
    "idx_matches_analyzed_timestamp", Match.fully_analyzed, Match.game_start_timestamp
)
