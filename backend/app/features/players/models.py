"""Player data model for storing player information."""

from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
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


class Player(Base):
    """Player model storing Riot API player data."""

    __tablename__ = "players"
    __table_args__ = ({"schema": "core"},)

    # Primary key - PUUID is the unique identifier from Riot API
    # Note: Riot PUUID is a base64-encoded string, not a standard UUID
    puuid: Mapped[str] = mapped_column(
        String(78),  # Riot PUUIDs are 78 characters
        primary_key=True,
        index=True,
        comment="Player's universally unique identifier from Riot API",
    )

    # Player Name & Tag (Game Name + Tag Line)
    game_name: Mapped[str] = mapped_column(
        String(16), nullable=False, index=True, comment="Player's game name"
    )

    tag_line: Mapped[str] = mapped_column(
        String(5), nullable=False, comment="Player's tag line"
    )

    # Platform
    platform: Mapped[str] = mapped_column(
        String(4),
        nullable=False,
        index=True,
        comment="Platform (e.g. EUN1)",
    )

    # Player statistics
    profile_icon_id: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True, comment="Profile icon ID"
    )

    summoner_level: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True, comment="Summoner/Account level"
    )

    # Tracking & Analysis flags
    is_tracked: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        index=True,
        comment="Whether this player is tracked by at least one user for continuous updates",
    )

    # Timestamps
    last_playstyle_analysis: Mapped[Optional[datetime]] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=True,
        comment="Time of the last playstyle analysis",
    )

    last_matchmaking_analysis: Mapped[Optional[datetime]] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=True,
        comment="Time of the last matchmaking analysis",
    )

    created_at: Mapped[datetime] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        comment="When this player record was first created",
    )

    updated_at: Mapped[datetime] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
        comment="When this player record was last updated",
    )

    profile_synced_at: Mapped[Optional[datetime]] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=True,
        comment="Last successful Player Updater profile check",
    )

    league_synced_at: Mapped[Optional[datetime]] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=True,
        comment="Last successful Match Fetcher rank check",
    )

    match_synced_at: Mapped[Optional[datetime]] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=True,
        comment="Last complete successful Match Fetcher match check",
    )

    def __repr__(self) -> str:
        """Return string representation of the player."""
        return f"<Player(puuid='{self.puuid}', game_name='{self.game_name}#{self.tag_line}', platform='{self.platform}')>"

    # Database-only relationships - used by SQLAlchemy ORM but not directly referenced in Python code
    # These relationships enable database queries and cascade operations
    match_participations = relationship(  # noqa: F841 - Used by SQLAlchemy ORM
        "MatchParticipant", back_populates="player", cascade="all, delete-orphan"
    )
    playstyle_analysis = relationship(  # noqa: F841 - Used by SQLAlchemy ORM
        "PlaystyleAnalysis",
        back_populates="player",
        cascade="all, delete-orphan",
        uselist=False,
    )
    leagues = relationship(  # noqa: F841 - Used by SQLAlchemy ORM
        "PlayerLeague", back_populates="player", cascade="all, delete-orphan"
    )


# Create composite indexes for common queries
Index("idx_players_game_name_tag_line", Player.game_name, Player.tag_line)
