"""Match participant model for storing individual player performance in matches."""

from datetime import datetime
from decimal import Decimal
from typing import Any, Final

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Computed,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy import (
    DateTime as SQLDateTime,
)
from sqlalchemy import (
    Numeric as SQLDecimal,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.models import ABSENT_AS_NULL_JSONB, Base
from app.core.riot_api.constants import TEAM_IDS, TEAM_POSITIONS
from app.core.runs import ints_in_sql, nullable_values_in_sql


class MatchParticipant(Base):
    """Match participant model storing individual player performance data."""

    __tablename__ = "match_participants"
    __table_args__: Final = (
        # The PK is (match_id, participant_id); this separately guarantees a
        # player appears at most once per match, whichever slot they occupy.
        UniqueConstraint("match_id", "puuid", name="uq_match_participants_puuid_match"),
        CheckConstraint(ints_in_sql("team_id", TEAM_IDS), name="team_id_valid"),
        CheckConstraint(
            nullable_values_in_sql("team_position", sorted(TEAM_POSITIONS)),
            name="team_position_valid",
        ),
        {"schema": "core"},
    )

    # Composite Primary Key
    match_id: Mapped[str] = mapped_column(
        String(20),
        ForeignKey("core.matches.match_id", ondelete="CASCADE"),
        primary_key=True,
        nullable=False,
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

    profile_icon: Mapped[int | None] = mapped_column(Integer, nullable=True)

    summoner_level: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Team & Context
    team_id: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        # Led by `idx_participants_team_win`, as `champion_id` below is led by
        # `idx_participants_champion_win`.
        comment="100 (Blue) or 200 (Red)",
    )

    team_position: Mapped[str | None] = mapped_column(
        String(16), nullable=True, comment="TOP, JUNGLE, MIDDLE, BOTTOM, UTILITY"
    )

    # Champion
    champion_id: Mapped[int] = mapped_column(Integer, nullable=False)

    champion_name: Mapped[str] = mapped_column(String(32), nullable=False)

    champion_level: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    champion_transform: Mapped[int | None] = mapped_column(
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
    lp_change: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
        comment="Observed Solo/Duo LP change; null when unavailable",
    )
    lp_change_source: Mapped[str | None] = mapped_column(
        String(32),
        nullable=True,
        comment="Provenance of the persisted LP value or unavailable state",
    )
    lp_change_reason: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
        comment="Stable reason for the LP observation result",
    )
    lp_before_snapshot_at: Mapped[datetime | None] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=True,
        comment="League snapshot preceding the LP observation window",
    )
    lp_after_snapshot_at: Mapped[datetime | None] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=True,
        comment="League snapshot closing the LP observation window",
    )

    # KDA
    kills: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    deaths: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    assists: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Computed KDA column
    kda: Mapped[Decimal] = mapped_column(
        SQLDecimal(5, 2),
        Computed(
            "CASE WHEN deaths = 0 THEN (kills + assists) ELSE ROUND((kills + assists)::numeric / deaths, 2) END",
            persisted=True,
        ),
        nullable=False,
    )

    largest_multi_kill: Mapped[int | None] = mapped_column(Integer, default=0)
    largest_killing_spree: Mapped[int | None] = mapped_column(Integer, default=0)
    first_blood_kill: Mapped[bool | None] = mapped_column(Boolean, default=False)
    first_tower_kill: Mapped[bool | None] = mapped_column(Boolean, default=False)

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

    items_purchased: Mapped[int | None] = mapped_column(Integer, default=0)
    consumables_purchased: Mapped[int | None] = mapped_column(Integer, default=0)
    role_bound_item: Mapped[int | None] = mapped_column(Integer, default=0)

    # Spells (Summoners)
    summoner1_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    summoner1_casts: Mapped[int | None] = mapped_column(Integer, default=0)
    summoner2_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    summoner2_casts: Mapped[int | None] = mapped_column(Integer, default=0)

    # Objectives (Kill/Stolen)
    turret_kills: Mapped[int | None] = mapped_column(Integer, default=0)
    inhibitor_kills: Mapped[int | None] = mapped_column(Integer, default=0)
    objectives_stolen: Mapped[int | None] = mapped_column(Integer, default=0)

    # Time
    time_spent_dead: Mapped[int | None] = mapped_column(Integer, default=0)
    time_played: Mapped[int | None] = mapped_column(Integer, default=0)

    # Advanced Stats (Challenges)
    solo_kills: Mapped[int | None] = mapped_column(Integer, default=0)
    gold_per_minute: Mapped[Decimal | None] = mapped_column(
        SQLDecimal(10, 2), default=0
    )
    vision_score_per_minute: Mapped[Decimal | None] = mapped_column(
        SQLDecimal(10, 2), default=0
    )
    kill_participation: Mapped[Decimal | None] = mapped_column(
        SQLDecimal(5, 4), default=0
    )
    team_damage_percentage: Mapped[Decimal | None] = mapped_column(
        SQLDecimal(5, 4), default=0
    )
    epic_monster_steals: Mapped[int | None] = mapped_column(Integer, default=0)

    # JSON Data
    runes: Mapped[dict[str, Any] | None] = mapped_column(
        ABSENT_AS_NULL_JSONB,
        nullable=True,
        comment=(
            "Full Perks/Runes JSON data structure.\n"
            "Contains style selections, perks, var1-3 values.\n"
            "Stored as JSONB to preserve the tree structure:\n"
            '{ "primaryStyle": 8000, "subStyle": 8300, "statPerks": {...}, '
            '"styles": [...] }'
        ),
    )
    advanced_stats: Mapped[dict[str, Any] | None] = mapped_column(
        ABSENT_AS_NULL_JSONB,
        nullable=True,
        comment=(
            "Full Challenges JSON data structure from Riot API.\n"
            "Contains granular stats like damagePerMinute, healFromMapSources, "
            "skillshotsDodged, etc.\n"
            "Kept as full JSON to avoid frequent schema migrations when Riot "
            "adds new challenges."
        ),
    )


# Composite indexes for common queries. No `idx_participants_match_puuid`:
# `uq_match_participants_puuid_match` is unique on the same two columns and
# already serves them, as the primary key does for `match_id`.

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
