"""Match participant model for storing individual player performance in matches."""

from decimal import Decimal
from typing import Optional, Dict, Any
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime as SQLDateTime,
    Numeric as SQLDecimal,
    ForeignKey,
    Integer,
    String,
    Computed,
    Index,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.models import Base


class MatchParticipant(Base):
    """Match participant model storing individual player performance data."""

    __tablename__ = "match_participants"
    __table_args__ = {"schema": "core"}

    # Composite Primary Key
    match_id: Mapped[str] = mapped_column(
        String(20),
        ForeignKey("core.matches.match_id", ondelete="CASCADE"),
        primary_key=True,
        nullable=False,
        index=True,
        comment="Reference to the match",
    )

    participant_id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        nullable=False,
        comment="Participant ID (1-10)",
    )

    puuid: Mapped[str] = mapped_column(
        String(78),
        ForeignKey("core.players.puuid", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="Reference to the player (Riot PUUID)",
    )

    # Identity
    game_name: Mapped[str] = mapped_column(
        String(16), nullable=False, comment="Player's game name"
    )

    tag_line: Mapped[str] = mapped_column(
        String(5), nullable=False, comment="Player's tag Line"
    )

    summoner_id: Mapped[Optional[str]] = mapped_column(
        String(63), nullable=True, comment="Legacy Summoner ID"
    )

    profile_icon: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    summoner_level: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    # Team & Context
    team_id: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        index=True,
        comment="100 (Blue) or 200 (Red)",
    )

    team_position: Mapped[Optional[str]] = mapped_column(
        String(16), nullable=True, comment="TOP, JUNGLE, MIDDLE, BOTTOM, UTILITY"
    )

    # Champion
    champion_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)

    champion_name: Mapped[str] = mapped_column(String(32), nullable=False)

    champion_level: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    champion_transform: Mapped[Optional[int]] = mapped_column(
        Integer, default=0, nullable=True
    )

    # Results
    win: Mapped[bool] = mapped_column(Boolean, nullable=False)
    remake: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        comment="Inverted eligibleForProgression",
    )

    # KDA
    kills: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    deaths: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    assists: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Computed KDA column
    kda: Mapped[Optional[Decimal]] = mapped_column(
        SQLDecimal(5, 2),
        Computed(
            "CASE WHEN deaths = 0 THEN (kills + assists) ELSE ROUND((kills + assists)::numeric / deaths, 2) END",
            persisted=True,
        ),
        nullable=True,
    )

    largest_multi_kill: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    largest_killing_spree: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    first_blood_kill: Mapped[Optional[bool]] = mapped_column(Boolean, default=False)
    first_tower_kill: Mapped[Optional[bool]] = mapped_column(Boolean, default=False)

    # Damage
    total_damage_dealt: Mapped[int] = mapped_column(Integer, default=0)
    total_damage_dealt_to_champions: Mapped[int] = mapped_column(Integer, default=0)
    physical_damage_dealt_to_champions: Mapped[int] = mapped_column(Integer, default=0)
    magic_damage_dealt_to_champions: Mapped[int] = mapped_column(Integer, default=0)
    true_damage_dealt_to_champions: Mapped[int] = mapped_column(Integer, default=0)
    damage_dealt_to_objectives: Mapped[int] = mapped_column(Integer, default=0)
    damage_dealt_to_turrets: Mapped[int] = mapped_column(Integer, default=0)

    # Taking Damage
    total_damage_taken: Mapped[int] = mapped_column(Integer, default=0)
    physical_damage_taken: Mapped[int] = mapped_column(Integer, default=0)
    magic_damage_taken: Mapped[int] = mapped_column(Integer, default=0)
    true_damage_taken: Mapped[int] = mapped_column(Integer, default=0)
    damage_self_mitigated: Mapped[int] = mapped_column(Integer, default=0)

    # Support
    total_self_healing: Mapped[int] = mapped_column(Integer, default=0)
    total_healing: Mapped[int] = mapped_column(Integer, default=0)
    total_shielding: Mapped[int] = mapped_column(Integer, default=0)

    # Vision
    vision_score: Mapped[int] = mapped_column(Integer, default=0)
    wards_placed: Mapped[int] = mapped_column(Integer, default=0)
    wards_killed: Mapped[int] = mapped_column(Integer, default=0)
    vision_wards_placed: Mapped[int] = mapped_column(Integer, default=0)
    vision_wards_bought: Mapped[int] = mapped_column(Integer, default=0)

    # Farming & Economy
    total_minions_killed: Mapped[int] = mapped_column(Integer, default=0)
    neutral_minions_killed: Mapped[int] = mapped_column(Integer, default=0)
    gold_earned: Mapped[int] = mapped_column(Integer, default=0)
    gold_spent: Mapped[int] = mapped_column(Integer, default=0)

    @property
    def cs(self) -> int:
        """Calculate total creep score (CS)."""
        return (self.total_minions_killed or 0) + (self.neutral_minions_killed or 0)

    # Items
    item0: Mapped[int] = mapped_column(Integer, default=0)
    item1: Mapped[int] = mapped_column(Integer, default=0)
    item2: Mapped[int] = mapped_column(Integer, default=0)
    item3: Mapped[int] = mapped_column(Integer, default=0)
    item4: Mapped[int] = mapped_column(Integer, default=0)
    item5: Mapped[int] = mapped_column(Integer, default=0)
    trinket: Mapped[int] = mapped_column(Integer, default=0)

    items_purchased: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    consumables_purchased: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    role_bound_item: Mapped[Optional[int]] = mapped_column(Integer, default=0)

    # Spells (Summoners)
    summoner1_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    summoner1_casts: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    summoner2_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    summoner2_casts: Mapped[Optional[int]] = mapped_column(Integer, default=0)

    # Objectives (Kill/Stolen)
    turret_kills: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    inhibitor_kills: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    objectives_stolen: Mapped[Optional[int]] = mapped_column(Integer, default=0)

    # Time
    time_spent_dead: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    time_played: Mapped[Optional[int]] = mapped_column(Integer, default=0)

    # JSON Data
    runes: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSONB, nullable=True, comment="Full Runes JSON"
    )
    advanced_stats: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSONB, nullable=True, comment="Full Challenges JSON"
    )

    # Relationships
    match = relationship("Match", back_populates="participants")
    player = relationship("Player", back_populates="match_participations")

    def __repr__(self) -> str:
        """Return string representation of the match participant."""
        return f"<MatchParticipant({self.match_id}, {self.participant_id}, {self.game_name})>"


# Create composite indexes for common queries
Index("idx_participants_match_puuid", MatchParticipant.match_id, MatchParticipant.puuid)

Index(
    "idx_participants_champion_win", MatchParticipant.champion_id, MatchParticipant.win
)

Index("idx_participants_kills_deaths", MatchParticipant.kills, MatchParticipant.deaths)

Index(
    "idx_participants_position_champion",
    MatchParticipant.team_position,
    MatchParticipant.champion_id,
)

Index("idx_participants_team_win", MatchParticipant.team_id, MatchParticipant.win)
