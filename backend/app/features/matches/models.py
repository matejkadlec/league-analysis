"""Match data model for storing League of Legends match information."""

from datetime import datetime
from typing import Final, Literal

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Index,
    Integer,
    String,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.models import Base, created_at_column, updated_at_column

# Imported at runtime, not under TYPE_CHECKING: the name appears in a `Mapped`
# annotation, and SQLAlchemy resolves those by evaluating them. `participants`
# does not import this module, so there is no cycle.
from .participants import MatchParticipant


class Match(Base):
    """Match model storing League of Legends match data."""

    __tablename__ = "matches"
    __table_args__: Final = (
        # Same canonical spelling as `core.players.platform`. This column was
        # internally consistent at uppercase, but two columns of the same name
        # disagreeing is a comparison bug waiting to be written.
        # Spelled bare: the `ck` convention prefixes `ck_<table>_` itself.
        CheckConstraint(
            "platform = lower(platform)",
            name="platform_is_lowercase",
        ),
        # Created by revision 20260808_0004 but never mirrored here, so
        # autogenerate proposed dropping it.
        CheckConstraint(
            "game_start_timestamp_source IN "
            "('riot_game_start', 'legacy_game_creation')",
            name="start_timestamp_source",
        ),
        {"schema": "core"},
    )

    # Primary key - match ID from Riot API
    match_id: Mapped[str] = mapped_column(
        # Same width as the two tables that reference it.
        String(20),
        primary_key=True,
        comment="Unique match identifier from Riot API",
    )

    # Platform and routing information
    platform: Mapped[str] = mapped_column(
        String(4),
        nullable=False,
        comment="Platform where the match was played, canonical lowercase (e.g. euw1)",
    )

    # Game information
    game_creation_timestamp: Mapped[int] = mapped_column(
        BigInteger,
        nullable=False,
        comment="Riot loading-screen gameCreation timestamp in milliseconds",
    )

    game_start_timestamp: Mapped[int] = mapped_column(
        BigInteger,
        nullable=False,
        comment="Actual game start, or creation time for explicitly marked legacy rows",
    )

    game_start_timestamp_source: Mapped[
        Literal["riot_game_start", "legacy_game_creation"]
    ] = mapped_column(
        String(32),
        nullable=False,
        default="riot_game_start",
        comment="Source semantics for game_start_timestamp",
    )

    game_end_timestamp: Mapped[int] = mapped_column(
        BigInteger,
        nullable=False,
        comment="Game end timestamp in milliseconds since epoch",
    )

    game_duration: Mapped[int] = mapped_column(
        Integer, nullable=False, comment="Game duration in seconds"
    )

    queue_id: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment="Queue type ID (e.g., 420=Ranked Solo, 440=Ranked Flex)",
    )

    game_version: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        comment="Game version (e.g., '14.20.555.5555')",
    )

    map_id: Mapped[int] = mapped_column(
        Integer, nullable=False, comment="Map ID (e.g., 11=Summoner's Rift)"
    )

    # Game mode information
    game_mode: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        index=True,
        comment="Game mode (e.g., 'CLASSIC', 'ARAM')",
    )

    game_type: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        index=True,
        comment="Game type (e.g., 'MATCHED_GAME')",
    )

    # Match result
    early_surrender: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        comment="Whether the game ended in early surrender",
    )

    surrender: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        comment="Whether the game ended in surrender",
    )

    game_result: Mapped[str | None] = mapped_column(
        String(32),
        nullable=True,
        comment="End of game result",
    )

    # Timestamps
    created_at: Mapped[datetime] = created_at_column(
        "When this match record was created in our database"
    )

    updated_at: Mapped[datetime] = updated_at_column(
        "When this match record was last updated"
    )

    # Processing flags
    fully_analyzed: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        comment="Whether this match has been processed for playstyle analysis",
    )

    # The one relationship this application reads: `playstyle_analysis`
    # eager-loads it with `selectinload`. `lazy="raise"` is what SQLAlchemy's
    # asyncio docs prescribe for a codebase without `AsyncAttrs` -- a lazy load
    # from an async context is a MissingGreenlet, and this turns it into a
    # loud error at the access instead. One-directional: nothing ever read
    # `MatchParticipant.match`. No cascade either: the only ORM-level delete in
    # the app is on a table with no relationships at all, and
    # `match_participants.match_id` already cascades in the database.
    participants: Mapped[list[MatchParticipant]] = relationship(lazy="raise")


# Create indexes for common queries.
#
# None of the columns below also carries `index=True`. A btree on (a, b) already
# serves every lookup a btree on (a) would, so a single-column index on the
# leading column of one of these is pure write cost -- and `match_id` is the
# primary key, whose own index covers it. `game_mode` and `game_type` do carry
# `index=True`, because no composite here leads with either.
Index("idx_matches_platform_timestamp", Match.platform, Match.game_start_timestamp)

Index("idx_matches_queue_timestamp", Match.queue_id, Match.game_start_timestamp)

Index("idx_matches_version_timestamp", Match.game_version, Match.game_start_timestamp)

# Additional performance indexes for common query patterns
Index("idx_matches_timestamp_queue", Match.game_start_timestamp, Match.queue_id)

Index(
    "idx_matches_analyzed_timestamp", Match.fully_analyzed, Match.game_start_timestamp
)

# Partial index the baseline created for the "what still needs analysing?" scan.
# Narrower than the plain `fully_analyzed` index and cheap to keep, so it is
# declared rather than dropped.
Index(
    "idx_matches_processed",
    Match.fully_analyzed,
    postgresql_where=text("fully_analyzed = false"),
)
