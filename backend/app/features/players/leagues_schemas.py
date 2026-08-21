"""Pydantic schemas for PlayerLeague model."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.core.enums import Tier


class PlayerLeagueBase(BaseModel):
    """Base PlayerLeague schema with common attributes.

    Simplified schema - table is now immutable, each row is a snapshot.
    """

    puuid: str = Field(
        ..., max_length=78, description="Reference to the player (Riot PUUID)"
    )
    queue_type: str = Field(..., max_length=32, description="Queue type")
    tier: Tier = Field(..., description="Rank tier")
    rank: str | None = Field(default=None, max_length=4, description="Rank division")
    league_points: int = Field(default=0, ge=0, le=100, description="League points")
    wins: int = Field(default=0, ge=0, description="Number of wins")
    losses: int = Field(default=0, ge=0, description="Number of losses")


class PlayerLeagueResponse(PlayerLeagueBase):
    """Schema for PlayerLeague response."""

    created_at: datetime = Field(
        ..., description="When this league snapshot was recorded"
    )
    win_rate: float = Field(..., description="Win rate as a percentage")
    total_games: int = Field(..., description="Total number of games played")
    display_rank: str = Field(..., description="Display rank (e.g., 'Gold II')")

    model_config = ConfigDict(from_attributes=True)
