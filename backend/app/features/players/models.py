"""Player data model for storing player information."""

from datetime import datetime
from typing import override

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Index,
    Integer,
    String,
)
from sqlalchemy import (
    DateTime as SQLDateTime,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.models import Base, created_at_column, updated_at_column


class Player(Base):
    """Player model storing Riot API player data."""

    __tablename__ = "players"
    __table_args__ = (
        # Five write paths disagreed about this column's casing while two
        # lookups compared it case-sensitively, so a player first seen through
        # a match was stored lowercase and then could not be found by name and
        # tag. Normalising in Python fixes the code; this makes the invariant
        # the database's, so a future writer that forgets fails loudly instead
        # of silently hiding rows. Canonical is lowercase — Riot's own spelling
        # and the `Platform` enum's values. See `normalize_platform`.
        # Spelled bare: the `ck` convention prefixes `ck_<table>_` itself.
        CheckConstraint(
            "platform = lower(platform)",
            name="platform_is_lowercase",
        ),
        {"schema": "core"},
    )

    # Primary key - PUUID is the unique identifier from Riot API
    # Note: Riot PUUID is a base64-encoded string, not a standard UUID
    puuid: Mapped[str] = mapped_column(
        String(78),  # Riot PUUIDs are 78 characters
        primary_key=True,
        comment="Player's universally unique identifier from Riot API",
    )

    # Player Name & Tag (Game Name + Tag Line)
    game_name: Mapped[str] = mapped_column(
        String(16), nullable=False, comment="Player's game name"
    )

    tag_line: Mapped[str] = mapped_column(
        String(5), nullable=False, comment="Player's tag line"
    )

    # Platform
    platform: Mapped[str] = mapped_column(
        String(4),
        nullable=False,
        index=True,
        comment="Platform, canonical lowercase (e.g. eun1)",
    )

    # Player statistics
    profile_icon_id: Mapped[int | None] = mapped_column(
        Integer, nullable=True, comment="Profile icon ID"
    )

    summoner_level: Mapped[int | None] = mapped_column(
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
    last_playstyle_analysis: Mapped[datetime | None] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=True,
        comment="Time of the last playstyle analysis",
    )

    last_matchmaking_analysis: Mapped[datetime | None] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=True,
        comment="Time of the last matchmaking analysis",
    )

    created_at: Mapped[datetime] = created_at_column(
        "When this player record was first created"
    )

    updated_at: Mapped[datetime] = updated_at_column(
        "When this player record was last updated"
    )

    profile_synced_at: Mapped[datetime | None] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=True,
        comment="Last successful Player Updater profile check",
    )

    league_synced_at: Mapped[datetime | None] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=True,
        comment="Last successful Match Fetcher rank check",
    )

    match_synced_at: Mapped[datetime | None] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=True,
        comment="Last complete successful Match Fetcher match check",
    )

    @override
    def __repr__(self) -> str:
        """Return string representation of the player."""
        return f"<Player(puuid='{self.puuid}', game_name='{self.game_name}#{self.tag_line}', platform='{self.platform}')>"

    # Database-only relationships - used by SQLAlchemy ORM but not directly referenced in Python code
    # These relationships enable database queries and cascade operations
    match_participations = relationship(
        "MatchParticipant", back_populates="player", cascade="all, delete-orphan"
    )
    playstyle_analysis = relationship(
        "PlaystyleAnalysis",
        back_populates="player",
        cascade="all, delete-orphan",
        uselist=False,
    )
    leagues = relationship(
        "PlayerLeague", back_populates="player", cascade="all, delete-orphan"
    )


# Create composite indexes for common queries. `game_name` carries no
# `index=True` of its own -- this index leads with it and so serves a game-name
# lookup already -- and neither does `puuid`, which the primary key covers.
Index("idx_players_game_name_tag_line", Player.game_name, Player.tag_line)
