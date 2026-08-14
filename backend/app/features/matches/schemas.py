"""Pydantic schemas for Match model."""

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.features.matches.rune_transform import transform_runes_payload


class MatchBase(BaseModel):
    """Base Match schema with common attributes."""

    platform: str = Field(
        ..., max_length=4, description="Platform where the match was played"
    )
    game_creation_timestamp: int = Field(
        ..., description="Loading-screen timestamp in milliseconds since epoch"
    )
    game_start_timestamp: int = Field(
        ..., description="Effective game start timestamp in milliseconds since epoch"
    )
    game_start_timestamp_source: Literal["riot_game_start", "legacy_game_creation"] = (
        Field(
            ...,
            description="Whether the effective start is actual or a legacy fallback",
        )
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


class RunesData(BaseModel):
    """Schema for runes data with flattened structure."""

    primary_style: Optional[int] = Field(None, description="Primary rune style ID")
    sub_style: Optional[int] = Field(None, description="Sub rune style ID")
    keystone: Optional[int] = Field(None, description="Keystone rune ID")
    primary_perks: Optional[List[int]] = Field(None, description="Primary perk IDs")
    sub_perks: Optional[List[int]] = Field(None, description="Sub perk IDs")
    stat_perks: Optional[Dict[str, int]] = Field(None, description="Stat perk values")

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
    total_damage_dealt_to_champions: int = Field(
        0, description="Total damage to champions"
    )
    summoner1_id: Optional[int] = Field(None, description="First summoner spell ID")
    summoner2_id: Optional[int] = Field(None, description="Second summoner spell ID")
    runes: Optional[RunesData] = Field(None, description="Runes data")

    @field_validator("runes", mode="before")
    @classmethod
    def transform_runes(cls, v: Any) -> Optional[Dict[str, Any]]:
        """Transform raw Riot API perks structure to flattened runes data."""
        return transform_runes_payload(v)

    model_config = ConfigDict(from_attributes=True)


class EnemyLaneOpponent(BaseModel):
    """Schema for the enemy lane opponent."""

    champion_id: int = Field(..., description="Enemy champion ID")
    champion_name: str = Field(..., description="Enemy champion name")
    champion_level: int = Field(..., description="Enemy champion level")
    kills: int = Field(0, description="Enemy kills")
    deaths: int = Field(0, description="Enemy deaths")
    assists: int = Field(0, description="Enemy assists")
    kda: Optional[float] = Field(None, description="Enemy KDA")
    total_cs: int = Field(0, description="Enemy total CS")
    vision_score: int = Field(0, description="Enemy vision score")
    total_damage_dealt_to_champions: int = Field(
        0, description="Enemy damage to champions"
    )
    summoner1_id: Optional[int] = Field(
        None, description="Enemy first summoner spell ID"
    )
    summoner2_id: Optional[int] = Field(
        None, description="Enemy second summoner spell ID"
    )
    runes: Optional[RunesData] = Field(None, description="Enemy runes data")

    @field_validator("runes", mode="before")
    @classmethod
    def transform_runes(cls, v: Any) -> Optional[Dict[str, Any]]:
        """Transform raw Riot API perks structure to flattened runes data."""
        return transform_runes_payload(v)

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


class TeamStats(BaseModel):
    """Schema for aggregated team statistics."""

    kills: int = Field(0, description="Total team kills")
    deaths: int = Field(0, description="Total team deaths")
    assists: int = Field(0, description="Total team assists")
    kda: Optional[float] = Field(None, description="Team KDA")
    turrets: Optional[int] = Field(
        None,
        description="Total turrets destroyed (null when timeline data is missing)",
    )
    inhibitors: Optional[int] = Field(
        None,
        description="Total inhibitors destroyed (null when timeline data is missing)",
    )
    dragons: Optional[int] = Field(
        None, description="Total dragons killed (null when timeline data is missing)"
    )
    barons: int = Field(
        0,
        description="Total barons killed (timeline-backed, fallback to participant stats)",
    )
    rift_heralds: int = Field(
        0,
        description="Total rift heralds killed (timeline-backed, fallback to participant stats)",
    )
    voidgrubs: Optional[int] = Field(
        None,
        description="Total voidgrubs killed (null when timeline data is missing)",
    )

    model_config = ConfigDict(from_attributes=True)


class TeamStatsComposition(BaseModel):
    """Schema for both team statistics."""

    blue_team: TeamStats = Field(
        default_factory=lambda: TeamStats.model_validate({}),
        description="Blue team stats",
    )
    red_team: TeamStats = Field(
        default_factory=lambda: TeamStats.model_validate({}),
        description="Red team stats",
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
    team_stats: Optional[TeamStatsComposition] = Field(
        None, description="Team statistics for the match"
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


class ChampionStatsItem(BaseModel):
    """Schema for stats of a single champion."""

    champion_name: str = Field(..., description="Champion name")
    champion_id: int = Field(..., description="Champion ID")
    games_played: int = Field(..., ge=0, description="Number of games played")
    wins: int = Field(..., ge=0, description="Number of wins")
    losses: int = Field(..., ge=0, description="Number of losses")
    win_rate: float = Field(..., ge=0.0, le=1.0, description="Win rate (0.0 to 1.0)")
    avg_kills: float = Field(..., ge=0.0, description="Average kills")
    avg_deaths: float = Field(..., ge=0.0, description="Average deaths")
    avg_assists: float = Field(..., ge=0.0, description="Average assists")
    avg_kda: float = Field(..., ge=0.0, description="Average KDA")

    model_config = ConfigDict(from_attributes=True)


class ChampionStatsResponse(BaseModel):
    """Schema for the complete ordered champion-statistics response."""

    puuid: str = Field(..., description="Player PUUID")
    total_champions: int = Field(..., ge=0, description="Total unique champions played")
    champions: List[ChampionStatsItem] = Field(
        default_factory=list,
        description="Every qualifying champion, ordered for local pagination",
    )

    model_config = ConfigDict(from_attributes=True)


class LaneStatsItem(BaseModel):
    """Schema for stats of a single lane/position."""

    lane: str = Field(
        ..., description="Lane/position name (TOP, JUNGLE, MID, ADC, SUPPORT)"
    )
    games_played: int = Field(..., ge=0, description="Number of games played")
    wins: int = Field(..., ge=0, description="Number of wins")
    losses: int = Field(..., ge=0, description="Number of losses")
    win_rate: float = Field(..., ge=0.0, le=1.0, description="Win rate (0.0 to 1.0)")
    avg_kills: float = Field(..., ge=0.0, description="Average kills")
    avg_deaths: float = Field(..., ge=0.0, description="Average deaths")
    avg_assists: float = Field(..., ge=0.0, description="Average assists")
    avg_kda: float = Field(..., ge=0.0, description="Average KDA")

    model_config = ConfigDict(from_attributes=True)


class LaneStatsResponse(BaseModel):
    """Schema for lane stats response."""

    puuid: str = Field(..., description="Player PUUID")
    total_lanes: int = Field(..., ge=0, description="Total unique lanes played")
    lanes: List[LaneStatsItem] = Field(
        default_factory=list, description="List of lane stats"
    )

    model_config = ConfigDict(from_attributes=True)
