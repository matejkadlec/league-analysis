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
    league_id: str | None = Field(
        default=None,
        max_length=36,
        description="Riot league ID when supplied by the upstream response",
    )
    queue_type: str = Field(..., max_length=32, description="Queue type")
    tier: Tier = Field(..., description="Rank tier")
    rank: str | None = Field(default=None, max_length=4, description="Rank division")
    league_points: int = Field(default=0, ge=0, le=100, description="League points")
    wins: int = Field(default=0, ge=0, description="Number of wins")
    losses: int = Field(default=0, ge=0, description="Number of losses")
    veteran: bool = Field(
        default=False, description="Whether player is a veteran (100+ games)"
    )
    inactive: bool = Field(
        default=False, description="Whether player is inactive (decay warning)"
    )
    fresh_blood: bool = Field(
        default=False, description="Whether player recently joined this tier"
    )
    hot_streak: bool = Field(
        default=False, description="Whether player is on a winning streak"
    )


class PlayerLeagueCreate(PlayerLeagueBase):
    """Schema for creating a new PlayerLeague snapshot."""

    pass


class PlayerLeagueResponse(PlayerLeagueBase):
    """Schema for PlayerLeague response."""

    created_at: datetime = Field(
        ..., description="When this league snapshot was recorded"
    )
    win_rate: float = Field(..., description="Win rate as a percentage")
    total_games: int = Field(..., description="Total number of games played")
    display_rank: str = Field(..., description="Display rank (e.g., 'Gold II')")

    model_config = ConfigDict(from_attributes=True)
