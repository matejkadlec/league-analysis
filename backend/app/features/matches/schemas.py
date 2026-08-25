"""Pydantic schemas for Match model."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.schemas import PaginatedResponse
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
    # These five are NOT NULL columns. Declaring them optional here published
    # a `null` the database cannot produce, which zod then mirrored as
    # `.optional().nullable()` -- so dropping or renaming any of them on the
    # backend would have left every frontend parse passing.
    game_mode: str = Field(..., max_length=32, description="Game mode")
    game_type: str = Field(..., max_length=32, description="Game type")
    game_end_timestamp: int = Field(
        ..., description="Game end timestamp in milliseconds since epoch"
    )
    early_surrender: bool = Field(
        ..., description="Whether the game ended in early surrender"
    )
    surrender: bool = Field(..., description="Whether the game ended in surrender")
    game_result: str | None = Field(
        default=None, max_length=32, description="End of game result"
    )
    fully_analyzed: bool = Field(
        default=False,
        description="Whether this match has been processed for playstyle analysis",
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

    primary_style: int | None = Field(default=None, description="Primary rune style ID")
    sub_style: int | None = Field(default=None, description="Sub rune style ID")
    keystone: int | None = Field(default=None, description="Keystone rune ID")

    model_config = ConfigDict(from_attributes=True)


class PlayerMatchParticipant(BaseModel):
    """Schema for the player's participation in a match."""

    champion_id: int = Field(..., description="Champion ID")
    champion_name: str = Field(..., description="Champion name")
    champion_level: int = Field(..., description="Champion level at end of game")
    team_position: str | None = Field(default=None, description="Lane position")
    team_id: int = Field(..., description="Team ID (100=Blue, 200=Red)")
    win: bool = Field(..., description="Whether the player won")
    remake: bool = Field(default=False, description="Whether it was a remake")
    kills: int = Field(default=0, description="Kills")
    deaths: int = Field(default=0, description="Deaths")
    assists: int = Field(default=0, description="Assists")
    kda: float = Field(..., description="Computed KDA")
    total_cs: int = Field(default=0, description="Total CS (minions + monsters)")
    vision_score: int = Field(default=0, description="Vision score")
    total_damage_dealt_to_champions: int = Field(
        default=0, description="Total damage to champions"
    )
    summoner1_id: int | None = Field(
        default=None, description="First summoner spell ID"
    )
    summoner2_id: int | None = Field(
        default=None, description="Second summoner spell ID"
    )
    runes: RunesData | None = Field(default=None, description="Runes data")

    @field_validator("runes", mode="before")
    @classmethod
    def transform_runes(cls, v: object) -> object:
        """Transform raw Riot API perks structure to flattened runes data."""
        return transform_runes_payload(v)

    model_config = ConfigDict(from_attributes=True)


class EnemyLaneOpponent(BaseModel):
    """Schema for the enemy lane opponent."""

    puuid: str = Field(..., description="Enemy PUUID")
    game_name: str = Field(..., description="Enemy Riot ID game name")
    tag_line: str = Field(..., description="Enemy Riot ID tag line")
    champion_id: int = Field(..., description="Enemy champion ID")
    champion_name: str = Field(..., description="Enemy champion name")
    champion_level: int = Field(..., description="Enemy champion level")
    kills: int = Field(default=0, description="Enemy kills")
    deaths: int = Field(default=0, description="Enemy deaths")
    assists: int = Field(default=0, description="Enemy assists")
    kda: float = Field(..., description="Enemy KDA")
    total_cs: int = Field(default=0, description="Enemy total CS")
    vision_score: int = Field(default=0, description="Enemy vision score")
    total_damage_dealt_to_champions: int = Field(
        default=0, description="Enemy damage to champions"
    )
    summoner1_id: int | None = Field(
        default=None, description="Enemy first summoner spell ID"
    )
    summoner2_id: int | None = Field(
        default=None, description="Enemy second summoner spell ID"
    )
    runes: RunesData | None = Field(default=None, description="Enemy runes data")

    @field_validator("runes", mode="before")
    @classmethod
    def transform_runes(cls, v: object) -> object:
        """Transform raw Riot API perks structure to flattened runes data."""
        return transform_runes_payload(v)

    model_config = ConfigDict(from_attributes=True)


class TeamChampion(BaseModel):
    """Schema for a champion in team composition."""

    champion_id: int = Field(..., description="Champion ID")
    champion_name: str = Field(..., description="Champion name")
    team_position: str | None = Field(default=None, description="Lane position")
    puuid: str = Field(..., description="Player PUUID")
    game_name: str = Field(..., description="Riot ID game name")
    tag_line: str = Field(..., description="Riot ID tag line")

    model_config = ConfigDict(from_attributes=True)


class TeamComposition(BaseModel):
    """Schema for team compositions in a match."""

    blue_team: list[TeamChampion] = Field(
        default_factory=list[TeamChampion], description="Blue team (100) champions"
    )
    red_team: list[TeamChampion] = Field(
        default_factory=list[TeamChampion], description="Red team (200) champions"
    )

    model_config = ConfigDict(from_attributes=True)


class TeamStats(BaseModel):
    """Schema for aggregated team statistics."""

    kills: int = Field(default=0, description="Total team kills")
    deaths: int = Field(default=0, description="Total team deaths")
    assists: int = Field(default=0, description="Total team assists")
    turrets: int | None = Field(
        default=None,
        description="Total turrets destroyed (null when timeline data is missing)",
    )
    inhibitors: int | None = Field(
        default=None,
        description="Total inhibitors destroyed (null when timeline data is missing)",
    )
    dragons: int | None = Field(
        default=None,
        description="Total dragons killed (null when timeline data is missing)",
    )
    barons: int = Field(
        default=0,
        description="Total barons killed (timeline-backed, fallback to participant stats)",
    )
    rift_heralds: int = Field(
        default=0,
        description="Total rift heralds killed (timeline-backed, fallback to participant stats)",
    )
    voidgrubs: int | None = Field(
        default=None,
        description="Total voidgrubs killed (null when timeline data is missing)",
    )

    model_config = ConfigDict(from_attributes=True)


class TeamStatsComposition(BaseModel):
    """Schema for both team statistics."""

    # Required, not defaulted: `match_history.py` is the only construction
    # site and it passes both. The `default_factory` was an empty-dict round
    # trip that has never fired, and it made the response schema claim a shape
    # no response has.
    blue_team: TeamStats = Field(description="Blue team stats")
    red_team: TeamStats = Field(description="Red team stats")

    model_config = ConfigDict(from_attributes=True)


class MatchWithPlayerData(MatchResponse):
    """Match response including player-specific participant data."""

    player_participant: PlayerMatchParticipant | None = Field(
        default=None, description="The player's participation data"
    )
    lane_opponent: EnemyLaneOpponent | None = Field(
        default=None, description="The enemy lane opponent"
    )
    lp_change: int | None = Field(
        default=None,
        description="Persisted observed LP change, or null when unavailable",
    )
    team_compositions: TeamComposition | None = Field(
        default=None, description="Team compositions for the match"
    )
    team_stats: TeamStatsComposition | None = Field(
        default=None, description="Team statistics for the match"
    )

    model_config = ConfigDict(from_attributes=True)


class MatchListResponse(PaginatedResponse):
    """Schema for paginated Match list response."""

    matches: list[MatchResponse]
    total_analyzed: int = Field(
        default=0, description="Total number of fully analyzed matches"
    )


class MatchListWithPlayerDataResponse(PaginatedResponse):
    """Schema for paginated Match list with player participation data."""

    matches: list[MatchWithPlayerData]
    total_analyzed: int = Field(
        default=0, description="Total number of fully analyzed matches"
    )


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
    champions: list[ChampionStatsItem] = Field(
        default_factory=list[ChampionStatsItem],
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
    lanes: list[LaneStatsItem] = Field(
        default_factory=list[LaneStatsItem], description="List of lane stats"
    )

    model_config = ConfigDict(from_attributes=True)
