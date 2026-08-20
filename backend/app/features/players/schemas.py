"""Pydantic schemas for Player model."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class PlayerBase(BaseModel):
    """Base player schema with common fields."""

    puuid: str = Field(..., min_length=78, max_length=78, description="Player's PUUID")
    game_name: str = Field(..., description="Riot ID game name")
    tag_line: str = Field(..., description="Riot tag line")
    platform: str = Field(..., description="Platform (e.g. EUN1)")
    summoner_level: int = Field(..., description="Account/Summoner level")
    profile_icon_id: int = Field(..., description="Profile icon ID")


class PlayerResponse(PlayerBase):
    """Schema for player response data."""

    created_at: datetime
    updated_at: datetime

    is_tracked: bool = Field(
        default=False,
        description="Whether this player is tracked by the current user",
    )
    total_matches: int = Field(
        default=0,
        description="Total matches recorded in database",
    )
    analyzed_matches: int = Field(
        default=0,
        description="Number of matches that are fully analyzed",
    )
    last_playstyle_analysis: datetime | None = Field(
        default=None, description="Time of last playstyle analysis"
    )
    last_matchmaking_analysis: datetime | None = Field(
        default=None, description="Time of last matchmaking analysis"
    )
    profile_synced_at: datetime | None = Field(
        default=None, description="Last successful profile identity check"
    )
    league_synced_at: datetime | None = Field(
        default=None, description="Last successful ranked-data check"
    )
    match_synced_at: datetime | None = Field(
        default=None, description="Last complete successful match-history check"
    )

    model_config = ConfigDict(from_attributes=True)


class CurrentPlayerUpdate(BaseModel):
    """Set or clear the authenticated user's normal current player."""

    puuid: str | None = Field(default=None, min_length=78, max_length=78)


class PlayerContextResponse(BaseModel):
    """Per-user navigation context over shared canonical player records."""

    current_player: PlayerResponse | None = None
    tracked_players: list[PlayerResponse]


class PlayerSyncRunResponse(BaseModel):
    """Authoritative lifecycle for an explicit current-player update."""

    id: int
    puuid: str
    status: Literal[
        "pending",
        "running",
        "completed",
        "failed",
        "cancelled",
        "rate_limited",
    ]
    match_execution_id: int | None = None
    profile_execution_id: int | None = None
    error_code: str | None = None
    error_message: str | None = None
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
