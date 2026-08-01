"""Pydantic schemas for MatchParticipant model."""

from decimal import Decimal
from typing import Any, Dict, Optional

from pydantic import BaseModel, ConfigDict, Field


class MatchParticipantBase(BaseModel):
    """Base MatchParticipant schema with common attributes."""

    # Identity
    match_id: str = Field(..., max_length=64, description="Reference to the match")
    participant_id: int = Field(..., ge=1, le=10, description="Participant ID (1-10)")
    puuid: str = Field(
        ..., max_length=78, description="Reference to the player (Riot PUUID)"
    )

    game_name: Optional[str] = Field(None, max_length=64, description="Riot ID Name")
    tag_line: Optional[str] = Field(None, max_length=8, description="Riot ID Tag")
    summoner_id: Optional[str] = Field(
        None, max_length=63, description="Legacy Summoner ID"
    )
    profile_icon: int = Field(0, description="Profile Icon ID")
    summoner_level: int = Field(1, description="Summoner Level")

    # Team & Context
    team_id: int = Field(..., description="100 (Blue) or 200 (Red)")
    team_position: Optional[str] = Field(
        None, max_length=16, description="TOP, JUNGLE, MIDDLE, BOTTOM, UTILITY"
    )

    # Champion
    champion_id: int = Field(..., description="Champion ID")
    champion_name: str = Field(..., max_length=32, description="Champion Name")
    champion_level: int = Field(1, ge=1, description="Champion Level")
    champion_transform: int = Field(0, description="Kayn Transform etc.")

    # Results
    win: bool = Field(..., description="Did the team win?")
    remake: bool = Field(
        False, description="Was the game a remake (inverted eligibleForProgression)?"
    )

    # KDA
    kills: int = Field(0, ge=0)
    deaths: int = Field(0, ge=0)
    assists: int = Field(0, ge=0)
    kda: Optional[Decimal] = Field(
        None, max_digits=5, decimal_places=2, description="Calculated KDA"
    )

    largest_multi_kill: int = Field(0)
    largest_killing_spree: int = Field(0)
    first_blood_kill: bool = Field(False)
    first_tower_kill: bool = Field(False)

    # Damage
    total_damage_dealt: int = Field(0)
    total_damage_dealt_to_champions: int = Field(0)
    physical_damage_dealt_to_champions: int = Field(0)
    magic_damage_dealt_to_champions: int = Field(0)
    true_damage_dealt_to_champions: int = Field(0)
    damage_dealt_to_objectives: int = Field(0)
    damage_dealt_to_turrets: int = Field(0)

    # Taking Damage
    total_damage_taken: int = Field(0)
    physical_damage_taken: int = Field(0)
    magic_damage_taken: int = Field(0)
    true_damage_taken: int = Field(0)
    damage_self_mitigated: int = Field(0)

    # Support
    total_self_healing: int = Field(0)
    total_healing: int = Field(0)
    total_shielding: int = Field(0)

    # Vision
    vision_score: int = Field(0)
    wards_placed: int = Field(0)
    wards_killed: int = Field(0)
    vision_wards_placed: int = Field(0)
    vision_wards_bought: int = Field(0)

    # Farming & Economy
    total_minions_killed: int = Field(0)
    neutral_minions_killed: int = Field(0)
    gold_earned: int = Field(0)
    gold_spent: int = Field(0)

    # Items
    item0: int = Field(0)
    item1: int = Field(0)
    item2: int = Field(0)
    item3: int = Field(0)
    item4: int = Field(0)
    item5: int = Field(0)
    trinket: int = Field(0)
    items_purchased: int = Field(0)
    consumables_purchased: int = Field(0)
    role_bound_item: int = Field(0)

    # Spells
    summoner1_id: Optional[int] = Field(None)
    summoner1_casts: int = Field(0)
    summoner2_id: Optional[int] = Field(None)
    summoner2_casts: int = Field(0)

    # Objectives
    turret_kills: int = Field(0)
    inhibitor_kills: int = Field(0)
    objectives_stolen: int = Field(0)

    # Time
    time_spent_dead: int = Field(0)
    time_played: int = Field(0)

    # JSON Data
    runes: Optional[Dict[str, Any]] = Field(None, description="Full Runes JSON")
    advanced_stats: Optional[Dict[str, Any]] = Field(
        None, description="Full Challenges JSON"
    )


class MatchParticipantCreate(MatchParticipantBase):
    """Schema for creating a new MatchParticipant."""

    pass


class MatchParticipantUpdate(BaseModel):
    """Schema for updating a MatchParticipant."""

    game_name: Optional[str] = None
    tag_line: Optional[str] = None
    # Add other updatable fields if necessary


class MatchParticipantResponse(MatchParticipantBase):
    """Schema for MatchParticipant response."""

    model_config = ConfigDict(from_attributes=True)
