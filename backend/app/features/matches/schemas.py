"""Pydantic schemas for Match model."""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field, ConfigDict


class MatchBase(BaseModel):
    """Base Match schema with common attributes."""

    platform: str = Field(
        ..., max_length=4, description="Platform where the match was played"
    )
    game_start_timestamp: int = Field(
        ..., description="Game creation timestamp in milliseconds since epoch"
    )
    game_duration: int = Field(..., ge=0, description="Game duration in seconds")
    queue_id: int = Field(..., description="Queue type ID")
    game_version: str = Field(..., max_length=32, description="Game version")
    map_id: int = Field(..., description="Map ID")
    game_mode: Optional[str] = Field(None, max_length=32, description="Game mode")
    game_type: Optional[str] = Field(None, max_length=32, description="Game type")
    game_end_timestamp: Optional[int] = Field(
        None, description="Game end timestamp in milliseconds since epoch"
    )
    early_surrender: Optional[bool] = Field(
        None, description="Whether the game ended in early surrender"
    )
    surrender: Optional[bool] = Field(
        None, description="Whether the game ended in surrender"
    )
    game_result: Optional[str] = Field(
        None, max_length=32, description="End of game result"
    )
    fully_analyzed: bool = Field(
        False,
        description="Whether this match has been processed for playstyle analysis",
    )


class MatchCreate(MatchBase):
    """Schema for creating a new Match."""

    match_id: str = Field(
        ..., max_length=64, description="Unique match identifier from Riot API"
    )


class MatchUpdate(BaseModel):
    """Schema for updating a Match."""

    game_duration: Optional[int] = Field(
        None, ge=0, description="Game duration in seconds"
    )
    game_end_timestamp: Optional[int] = Field(
        None, description="Game end timestamp in milliseconds since epoch"
    )
    game_mode: Optional[str] = Field(None, max_length=32, description="Game mode")
    game_type: Optional[str] = Field(None, max_length=32, description="Game type")
    fully_analyzed: Optional[bool] = Field(
        None, description="Whether this match has been processed for playstyle analysis"
    )


class MatchResponse(MatchBase):
    """Schema for Match response."""

    match_id: str = Field(
        ..., max_length=64, description="Unique match identifier from Riot API"
    )
    created_at: datetime = Field(
        ..., description="When this match record was created in our database"
    )
    updated_at: datetime = Field(
        ..., description="When this match record was last updated"
    )

    model_config = ConfigDict(from_attributes=True)


class PlayerMatchParticipant(BaseModel):
    """Schema for the player's participation in a match."""

    champion_id: int = Field(..., description="Champion ID")
    champion_name: str = Field(..., description="Champion name")
    champion_level: int = Field(..., description="Champion level at end of game")
    team_position: Optional[str] = Field(None, description="Lane position")
    team_id: int = Field(..., description="Team ID (100=Blue, 200=Red)")
    win: bool = Field(..., description="Whether the player won")
    remake: bool = Field(False, description="Whether it was a remake")
    kills: int = Field(0, description="Kills")
    deaths: int = Field(0, description="Deaths")
    assists: int = Field(0, description="Assists")
    kda: Optional[float] = Field(None, description="Computed KDA")
    total_cs: int = Field(0, description="Total CS (minions + monsters)")
    vision_score: int = Field(0, description="Vision score")

    model_config = ConfigDict(from_attributes=True)


class EnemyLaneOpponent(BaseModel):
    """Schema for the enemy lane opponent."""

    champion_id: int = Field(..., description="Enemy champion ID")
    champion_name: str = Field(..., description="Enemy champion name")
    champion_level: int = Field(..., description="Enemy champion level")
    kills: int = Field(0, description="Enemy kills")
    deaths: int = Field(0, description="Enemy deaths")
    assists: int = Field(0, description="Enemy assists")

    model_config = ConfigDict(from_attributes=True)


class TeamChampion(BaseModel):
    """Schema for a champion in team composition."""

    champion_id: int = Field(..., description="Champion ID")
    champion_name: str = Field(..., description="Champion name")
    team_position: Optional[str] = Field(None, description="Lane position")
    puuid: str = Field(..., description="Player PUUID")

    model_config = ConfigDict(from_attributes=True)


class TeamComposition(BaseModel):
    """Schema for team compositions in a match."""

    blue_team: List[TeamChampion] = Field(
        default_factory=list, description="Blue team (100) champions"
    )
    red_team: List[TeamChampion] = Field(
        default_factory=list, description="Red team (200) champions"
    )

    model_config = ConfigDict(from_attributes=True)


class MatchWithPlayerData(MatchResponse):
    """Match response including player-specific participant data."""

    player_participant: Optional[PlayerMatchParticipant] = Field(
        None, description="The player's participation data"
    )
    lane_opponent: Optional[EnemyLaneOpponent] = Field(
        None, description="The enemy lane opponent"
    )
    lp_change: Optional[int] = Field(None, description="LP change from this match")
    team_compositions: Optional[TeamComposition] = Field(
        None, description="Team compositions for the match"
    )

    model_config = ConfigDict(from_attributes=True)


class MatchListResponse(BaseModel):
    """Schema for paginated Match list response."""

    matches: List[MatchResponse]
    total: int = Field(..., description="Total matches available")
    total_analyzed: int = Field(0, description="Total number of fully analyzed matches")
    page: int = Field(..., description="Current page number")
    size: int = Field(..., description="Number of matches per page")
    pages: int = Field(..., description="Total number of pages")

    model_config = ConfigDict(from_attributes=True)


class MatchListWithPlayerDataResponse(BaseModel):
    """Schema for paginated Match list with player participation data."""

    matches: List[MatchWithPlayerData]
    total: int = Field(..., description="Total matches available")
    total_analyzed: int = Field(0, description="Total number of fully analyzed matches")
    page: int = Field(..., description="Current page number")
    size: int = Field(..., description="Number of matches per page")
    pages: int = Field(..., description="Total number of pages")

    model_config = ConfigDict(from_attributes=True)


class MatchStatsResponse(BaseModel):
    """Schema for player match statistics response."""

    puuid: str = Field(..., description="Player PUUID")
    total_matches: int = Field(..., ge=0, description="Total matches analyzed")
    wins: int = Field(..., ge=0, description="Number of wins")
    losses: int = Field(..., ge=0, description="Number of losses")
    win_rate: float = Field(..., ge=0.0, le=1.0, description="Win rate (0.0 to 1.0)")
    avg_kills: float = Field(..., ge=0.0, description="Average kills per match")
    avg_deaths: float = Field(..., ge=0.0, description="Average deaths per match")
    avg_assists: float = Field(..., ge=0.0, description="Average assists per match")
    avg_kda: float = Field(..., ge=0.0, description="Average KDA ratio")
    avg_cs: float = Field(..., ge=0.0, description="Average CS per match")
    avg_vision_score: float = Field(..., ge=0.0, description="Average vision score")

    model_config = ConfigDict(from_attributes=True)
