"""Pydantic schemas for Player model."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, ConfigDict


class PlayerBase(BaseModel):
    """Base player schema with common fields."""

    puuid: str = Field(..., min_length=78, max_length=78, description="Player's PUUID")
    game_name: str = Field(..., description="Riot ID game name")
    tag_line: str = Field(..., description="Riot tag line")
    platform: str = Field(..., description="Platform (e.g. EUN1)")
    summoner_level: int = Field(..., description="Account/Summoner level")
    profile_icon_id: int = Field(..., description="Profile icon ID")


class PlayerCreate(PlayerBase):
    """Schema for creating a new player."""

    pass


class PlayerUpdate(BaseModel):
    """Schema for updating an existing player."""

    game_name: Optional[str] = None
    tag_line: Optional[str] = None
    summoner_level: Optional[int] = None
    profile_icon_id: Optional[int] = None


class PlayerResponse(PlayerBase):
    """Schema for player response data."""

    created_at: datetime
    updated_at: datetime

    is_tracked: bool = Field(
        default=False,
        description="Whether this player is being tracked for automated updates",
    )
    fully_analyzed: bool = Field(
        default=False,
        description="Whether this player has been completely analyzed",
    )
    last_player_analysis: Optional[datetime] = Field(
        None, description="Time of last player analysis"
    )
    last_matchmaking_analysis: Optional[datetime] = Field(
        None, description="Time of last matchmaking analysis"
    )

    model_config = ConfigDict(from_attributes=True)


class PlayerListResponse(BaseModel):
    """Schema for paginated Player list response."""

    players: list[PlayerResponse]
    total: int
    page: int
    size: int
    pages: int

    model_config = ConfigDict(from_attributes=True)
