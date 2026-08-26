"""Pydantic schemas for PlayerLeague model."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.core.enums import Division, Tier
from app.core.riot_api.constants import LeagueQueueType


class PlayerLeagueResponse(BaseModel):
    """One immutable league snapshot, as the API returns it.

    `league_points` carries no upper bound on purpose: Master, Grandmaster and
    Challenger have no divisions and accumulate LP without a ceiling, so an
    `le=100` would 500 every read for a player above Diamond.
    """

    puuid: str = Field(
        ..., max_length=78, description="Reference to the player (Riot PUUID)"
    )
    queue_type: LeagueQueueType = Field(..., description="Queue type")
    tier: Tier = Field(..., description="Rank tier")
    rank: Division | None = Field(default=None, description="Rank division")
    league_points: int = Field(..., ge=0, description="League points")
    wins: int = Field(..., ge=0, description="Number of wins")
    losses: int = Field(..., ge=0, description="Number of losses")
    created_at: datetime = Field(
        ..., description="When this league snapshot was recorded"
    )
    win_rate: float = Field(..., description="Win rate as a percentage")
    total_games: int = Field(..., description="Total number of games played")
    display_rank: str = Field(..., description="Display rank (e.g., 'Gold II')")

    model_config = ConfigDict(from_attributes=True)
