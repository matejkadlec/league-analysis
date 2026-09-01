"""The League domain primitive: the snapshot table and the rules for taking one."""

from collections.abc import Sequence
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    String,
)
from sqlalchemy import (
    DateTime as SQLDateTime,
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.enums import Division, Tier
from app.core.models import Base
from app.core.riot_api.constants import LeagueQueueType
from app.core.riot_api.models import LeagueEntryDTO
from app.core.runs import nullable_values_in_sql, values_in_sql


class PlayerLeague(Base):
    """Player league model storing ranked information.

    This table is immutable - each row is a snapshot of league at a point in time.
    To get current league, order by created_at DESC and take the first result.
    """

    __tablename__ = "player_leagues"
    __table_args__ = (
        CheckConstraint(
            values_in_sql("tier", [tier.value for tier in Tier]),
            name="tier_valid",
        ),
        CheckConstraint(
            nullable_values_in_sql("rank", [division.value for division in Division]),
            name="rank_division_valid",
        ),
        CheckConstraint(
            values_in_sql("queue_type", [queue.value for queue in LeagueQueueType]),
            name="queue_type_valid",
        ),
        {"schema": "core"},
    )

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

    queue_type: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        index=True,
        comment="Queue type (e.g., RANKED_SOLO_5x5, RANKED_FLEX_SR)",
    )

    tier: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        # Led by both `idx_leagues_tier_rank` and `idx_leagues_tier_lp`.
        comment="Rank tier (e.g., GOLD, PLATINUM, DIAMOND)",
    )

    rank: Mapped[str | None] = mapped_column(
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


Index("idx_leagues_puuid_queue", PlayerLeague.puuid, PlayerLeague.queue_type)

Index("idx_leagues_tier_rank", PlayerLeague.tier, PlayerLeague.rank)

Index("idx_leagues_tier_lp", PlayerLeague.tier, PlayerLeague.league_points)

# `idx_leagues_puuid_created` used to sit here: the primary key spelled again
# with DESC, which a btree already serves by scanning backwards.


def solo_duo_league_entry(
    league_entries: Sequence[LeagueEntryDTO],
) -> LeagueEntryDTO | None:
    """Return the Solo/Duo league entry from a LEAGUE-V4 payload."""
    return next(
        (
            entry
            for entry in league_entries
            if entry.queue_type == LeagueQueueType.RANKED_SOLO_5x5
        ),
        None,
    )


def league_snapshot_matches(
    current_league: PlayerLeague, solo_entry: LeagueEntryDTO
) -> bool:
    """Return True when the stored snapshot matches the live Solo/Duo entry."""
    return (
        current_league.tier == solo_entry.tier
        and current_league.rank == solo_entry.rank
        and current_league.league_points == solo_entry.league_points
        and current_league.wins == solo_entry.wins
        and current_league.losses == solo_entry.losses
    )


def player_league_from_entry(puuid: str, solo_entry: LeagueEntryDTO) -> PlayerLeague:
    """Build an immutable league snapshot from a live Solo/Duo entry."""
    return PlayerLeague(
        puuid=puuid,
        queue_type=solo_entry.queue_type,
        tier=solo_entry.tier.value,
        rank=solo_entry.rank.value,
        league_points=solo_entry.league_points,
        wins=solo_entry.wins,
        losses=solo_entry.losses,
    )
