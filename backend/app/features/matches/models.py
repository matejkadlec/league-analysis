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
from app.core.riot_api.constants import Platform
from app.core.runs import values_in_sql

# Imported at runtime, not under TYPE_CHECKING: SQLAlchemy resolves `Mapped`
# annotations by evaluating them. `participants` does not import this module.
from .participants import MatchParticipant


class Match(Base):
    """Match model storing League of Legends match data."""

    __tablename__ = "matches"
    __table_args__: Final = (
        # Same canonical spelling as `core.players.platform`, so the two never
        # silently disagree in a comparison; bare because `ck` already prefixes it.
        CheckConstraint(
            "platform = lower(platform)",
            name="platform_is_lowercase",
        ),
        CheckConstraint(
            values_in_sql("platform", [p.value for p in Platform]),
            name="platform_supported",
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

    match_id: Mapped[str] = mapped_column(
        # Same width as the two tables that reference it.
        String(20),
        primary_key=True,
        comment="Unique match identifier from Riot API",
    )

    platform: Mapped[str] = mapped_column(
        String(4),
        nullable=False,
        comment="Platform where the match was played, canonical lowercase (e.g. euw1)",
    )

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

    created_at: Mapped[datetime] = created_at_column(
        "When this match record was created in our database"
    )

    updated_at: Mapped[datetime] = updated_at_column(
        "When this match record was last updated"
    )

    fully_analyzed: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        comment="Whether this match has been processed for playstyle analysis",
    )

    # `lazy="raise"`: without `AsyncAttrs` a lazy load from async code is a
    # MissingGreenlet. No cascade -- `match_id` already cascades in the database.
    participants: Mapped[list[MatchParticipant]] = relationship(lazy="raise")


# No `index=True` on these columns: a btree on (a, b) already serves lookups on
# (a). `game_mode`/`game_type` carry it because no composite leads with either.
Index("idx_matches_platform_timestamp", Match.platform, Match.game_start_timestamp)

Index("idx_matches_queue_timestamp", Match.queue_id, Match.game_start_timestamp)

Index("idx_matches_version_timestamp", Match.game_version, Match.game_start_timestamp)

Index("idx_matches_timestamp_queue", Match.game_start_timestamp, Match.queue_id)

Index(
    "idx_matches_analyzed_timestamp", Match.fully_analyzed, Match.game_start_timestamp
)

# Narrower than the plain `fully_analyzed` index, for the needs-analysing scan.
# Cheap to keep, so it stays declared rather than dropped.
Index(
    "idx_matches_processed",
    Match.fully_analyzed,
    postgresql_where=text("fully_analyzed = false"),
)
