"""Pydantic schemas for PlayerLeague model."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.core.enums import Tier


class PlayerLeagueResponse(BaseModel):
    """One immutable league snapshot, as the API returns it.

    There is no separate base: this was a `PlayerLeagueBase` with exactly one
    subclass and no other user, so the two said the same thing twice.

    `league_points` carried `le=100`, which is true of Iron through Diamond and
    false of the three tiers above them -- Master, Grandmaster and Challenger
    have no divisions and accumulate LP without a ceiling. Nothing writes a
    clamp (`service.py` stores Riot's own value) and no CHECK constraint backs
    it, so the bound could only ever turn a real row into a
    `ResponseValidationError` -- a 500 on `GET /players/{puuid}/league` for
    every player above Diamond. Production has never hit it because the
    tracked set tops out at Diamond 49 LP.
    """

    puuid: str = Field(
        ..., max_length=78, description="Reference to the player (Riot PUUID)"
    )
    queue_type: str = Field(..., max_length=32, description="Queue type")
    tier: Tier = Field(..., description="Rank tier")
    rank: str | None = Field(default=None, max_length=4, description="Rank division")
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
