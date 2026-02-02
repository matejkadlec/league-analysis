"""Pydantic schemas for PlayerRank model."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, ConfigDict

from app.core.enums import Tier


class PlayerRankBase(BaseModel):
    """Base PlayerRank schema with common attributes.

    Simplified schema - table is now immutable, each row is a snapshot.
    """

    puuid: str = Field(
        ..., max_length=78, description="Reference to the player (Riot PUUID)"
    )
    queue_type: str = Field(..., max_length=32, description="Queue type")
    tier: Tier = Field(..., description="Rank tier")
    rank: Optional[str] = Field(None, max_length=4, description="Rank division")
    league_points: int = Field(0, ge=0, le=100, description="League points")
    wins: int = Field(0, ge=0, description="Number of wins")
    losses: int = Field(0, ge=0, description="Number of losses")
    hot_streak: bool = Field(False, description="Whether player is on a winning streak")


class PlayerRankCreate(PlayerRankBase):
    """Schema for creating a new PlayerRank snapshot."""

    pass


class PlayerRankResponse(PlayerRankBase):
    """Schema for PlayerRank response."""

    id: int = Field(..., description="Auto-incrementing primary key")
    created_at: datetime = Field(
        ..., description="When this rank snapshot was recorded"
    )
    win_rate: float = Field(..., description="Win rate as a percentage")
    total_games: int = Field(..., description="Total number of games played")
    display_rank: str = Field(..., description="Display rank (e.g., 'Gold II')")

    model_config = ConfigDict(from_attributes=True)
