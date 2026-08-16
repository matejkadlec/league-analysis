"""Pydantic schemas for MatchParticipant model."""

from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class MatchParticipantBase(BaseModel):
    """Base MatchParticipant schema with common attributes."""

    # Identity
    match_id: str = Field(..., max_length=64, description="Reference to the match")
    participant_id: int = Field(..., ge=1, le=10, description="Participant ID (1-10)")
    puuid: str = Field(
        ..., max_length=78, description="Reference to the player (Riot PUUID)"
    )

    game_name: str | None = Field(
        default=None, max_length=64, description="Riot ID Name"
    )
    tag_line: str | None = Field(default=None, max_length=8, description="Riot ID Tag")
    summoner_id: str | None = Field(
        default=None, max_length=63, description="Legacy Summoner ID"
    )
    profile_icon: int = Field(default=0, description="Profile Icon ID")
    summoner_level: int = Field(default=1, description="Summoner Level")

    # Team & Context
    team_id: int = Field(..., description="100 (Blue) or 200 (Red)")
    team_position: str | None = Field(
        default=None, max_length=16, description="TOP, JUNGLE, MIDDLE, BOTTOM, UTILITY"
    )

    # Champion
    champion_id: int = Field(..., description="Champion ID")
    champion_name: str = Field(..., max_length=32, description="Champion Name")
    champion_level: int = Field(default=1, ge=1, description="Champion Level")
    champion_transform: int = Field(default=0, description="Kayn Transform etc.")

    # Results
    win: bool = Field(..., description="Did the team win?")
    remake: bool = Field(
        default=False,
        description="Was the game a remake (inverted eligibleForProgression)?",
    )

    # KDA
    kills: int = Field(default=0, ge=0)
    deaths: int = Field(default=0, ge=0)
    assists: int = Field(default=0, ge=0)
    kda: Decimal | None = Field(
        default=None, max_digits=5, decimal_places=2, description="Calculated KDA"
    )

    largest_multi_kill: int = Field(default=0)
    largest_killing_spree: int = Field(default=0)
    first_blood_kill: bool = Field(default=False)
    first_tower_kill: bool = Field(default=False)

    # Damage
    total_damage_dealt: int = Field(default=0)
    total_damage_dealt_to_champions: int = Field(default=0)
    physical_damage_dealt_to_champions: int = Field(default=0)
    magic_damage_dealt_to_champions: int = Field(default=0)
    true_damage_dealt_to_champions: int = Field(default=0)
    damage_dealt_to_objectives: int = Field(default=0)
    damage_dealt_to_turrets: int = Field(default=0)

    # Taking Damage
    total_damage_taken: int = Field(default=0)
    physical_damage_taken: int = Field(default=0)
    magic_damage_taken: int = Field(default=0)
    true_damage_taken: int = Field(default=0)
    damage_self_mitigated: int = Field(default=0)

    # Support
    total_self_healing: int = Field(default=0)
    total_healing: int = Field(default=0)
    total_shielding: int = Field(default=0)

    # Vision
    vision_score: int = Field(default=0)
    wards_placed: int = Field(default=0)
    wards_killed: int = Field(default=0)
    vision_wards_placed: int = Field(default=0)
    vision_wards_bought: int = Field(default=0)

    # Farming & Economy
    total_minions_killed: int = Field(default=0)
    neutral_minions_killed: int = Field(default=0)
    gold_earned: int = Field(default=0)
    gold_spent: int = Field(default=0)

    # Items
    item0: int = Field(default=0)
    item1: int = Field(default=0)
    item2: int = Field(default=0)
    item3: int = Field(default=0)
    item4: int = Field(default=0)
    item5: int = Field(default=0)
    trinket: int = Field(default=0)
    items_purchased: int = Field(default=0)
    consumables_purchased: int = Field(default=0)
    role_bound_item: int = Field(default=0)

    # Spells
    summoner1_id: int | None = Field(default=None)
    summoner1_casts: int = Field(default=0)
    summoner2_id: int | None = Field(default=None)
    summoner2_casts: int = Field(default=0)

    # Objectives
    turret_kills: int = Field(default=0)
    inhibitor_kills: int = Field(default=0)
    objectives_stolen: int = Field(default=0)

    # Time
    time_spent_dead: int = Field(default=0)
    time_played: int = Field(default=0)

    # JSON Data
    runes: dict[str, Any] | None = Field(default=None, description="Full Runes JSON")
    advanced_stats: dict[str, Any] | None = Field(
        default=None, description="Full Challenges JSON"
    )


class MatchParticipantCreate(MatchParticipantBase):
    """Schema for creating a new MatchParticipant."""

    pass


class MatchParticipantUpdate(BaseModel):
    """Schema for updating a MatchParticipant."""

    game_name: str | None = None
    tag_line: str | None = None
    # Add other updatable fields if necessary


class MatchParticipantResponse(MatchParticipantBase):
    """Schema for MatchParticipant response."""

    model_config = ConfigDict(from_attributes=True)
