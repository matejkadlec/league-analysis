"""Player league model for storing ranked information."""

from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    ForeignKey,
    Index,
    Integer,
    String,
)
from sqlalchemy import (
    DateTime as SQLDateTime,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.models import Base


class PlayerLeague(Base):
    """Player league model storing ranked information.

    This table is immutable - each row is a snapshot of league at a point in time.
    To get current league, order by created_at DESC and take the first result.
    """

    __tablename__ = "player_leagues"
    __table_args__ = {"schema": "core"}

    # Composite primary key using puuid + created_at
    puuid: Mapped[str] = mapped_column(
        String(78),
        ForeignKey("core.players.puuid", ondelete="CASCADE"),
        primary_key=True,
        comment="Reference to the player (Riot PUUID)",
    )

    created_at: Mapped[datetime] = mapped_column(
        SQLDateTime(timezone=True),
        primary_key=True,
        server_default=func.now(),
        comment="When this league snapshot was recorded",
    )

    # League information
    league_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        nullable=True,
        index=True,
        comment="Optional Riot league ID (omitted by current by-PUUID responses)",
    )

    queue_type: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        index=True,
        comment="Queue type (e.g., RANKED_SOLO_5x5, RANKED_FLEX_SR)",
    )

    tier: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        index=True,
        comment="Rank tier (e.g., GOLD, PLATINUM, DIAMOND)",
    )

    rank: Mapped[Optional[str]] = mapped_column(
        String(4), nullable=True, index=True, comment="Rank division (I, II, III, IV)"
    )

    league_points: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, comment="League points (0-100)"
    )

    wins: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, comment="Number of wins in this queue"
    )

    losses: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, comment="Number of losses in this queue"
    )

    veteran: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        comment="Whether player is a veteran (100+ games in this queue)",
    )

    inactive: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        comment="Whether player is inactive (decay warning)",
    )

    fresh_blood: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        comment="Whether player recently joined this tier",
    )

    hot_streak: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        comment="Whether player is on a winning streak",
    )

    # Relationships
    player = relationship("Player", back_populates="leagues")

    def __repr__(self) -> str:
        """Return string representation of the player league."""
        return f"<PlayerLeague(puuid='{self.puuid}', queue='{self.queue_type}', tier='{self.tier}', rank='{self.rank}')>"

    @property
    def win_rate(self) -> float:
        """Calculate win rate as a percentage."""
        total_games = self.wins + self.losses
        if total_games == 0:
            return 0.0
        return (self.wins / total_games) * 100

    @property
    def total_games(self) -> int:
        """Get total number of games played."""
        return self.wins + self.losses

    @property
    def display_rank(self) -> str:
        """Get the display rank (e.g., 'Gold II')."""
        if self.rank:
            return f"{self.tier.title()} {self.rank}"
        return self.tier.title()


# Create composite indexes for common queries
Index("idx_leagues_puuid_queue", PlayerLeague.puuid, PlayerLeague.queue_type)

Index("idx_leagues_tier_rank", PlayerLeague.tier, PlayerLeague.rank)

Index("idx_leagues_tier_lp", PlayerLeague.tier, PlayerLeague.league_points)

Index("idx_leagues_puuid_created", PlayerLeague.puuid, PlayerLeague.created_at.desc())

Index("idx_leagues_league_id", PlayerLeague.league_id)
