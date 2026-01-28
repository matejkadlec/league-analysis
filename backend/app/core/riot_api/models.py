"""Pydantic models for Riot API response data."""

from typing import Optional, List
from pydantic import BaseModel, Field, ConfigDict


class AccountDTO(BaseModel):
    """Riot Account information."""

    puuid: str
    game_name: str = Field(..., alias="gameName")
    tag_line: str = Field(..., alias="tagLine")

    model_config = ConfigDict(populate_by_name=True)


class SummonerDTO(BaseModel):
    """League of Legends Summoner information."""

    id: Optional[str] = None
    puuid: str
    name: Optional[str] = None
    profile_icon_id: int = Field(..., alias="profileIconId")
    summoner_level: int = Field(..., alias="summonerLevel")

    model_config = ConfigDict(populate_by_name=True)


class MatchListDTO(BaseModel):
    """Match list response."""

    match_ids: List[str] = Field(..., alias="matchIds")
    start: int
    count: int
    total: Optional[int] = None
    puuid: Optional[str] = None

    model_config = ConfigDict(populate_by_name=True)


class ParticipantDTO(BaseModel):
    """Match participant information."""

    # Core IDs
    participant_id: int = Field(..., alias="participantId")
    puuid: str
    summoner_name: str = Field(..., alias="summonerName")
    summoner_id: Optional[str] = Field(None, alias="summonerId")
    summoner_level: int = Field(..., alias="summonerLevel")
    profile_icon: int = Field(..., alias="profileIcon")

    # Riot ID fields
    game_name: Optional[str] = Field(None, alias="riotIdGameName")
    tag_line: Optional[str] = Field(None, alias="riotIdTagline")

    # Team & Position
    team_id: int = Field(..., alias="teamId")
    team_position: Optional[str] = Field(None, alias="teamPosition")

    # Champions
    champion_id: int = Field(..., alias="championId")
    champion_name: str = Field(..., alias="championName")
    champion_level: int = Field(..., alias="champLevel")
    champion_transform: int = Field(0, alias="championTransform")

    # KDA & Perf
    win: bool
    kills: int
    deaths: int
    assists: int
    kda: float = Field(
        0.0
    )  # Calculated property in API, but explicit here for validation

    largest_multi_kill: int = Field(0, alias="largestMultiKill")
    largest_killing_spree: int = Field(0, alias="largestKillingSpree")
    first_blood_kill: bool = Field(False, alias="firstBloodKill")
    first_tower_kill: bool = Field(False, alias="firstTowerKill")

    # Economy & Vision
    gold_earned: int = Field(..., alias="goldEarned")
    gold_spent: int = Field(0, alias="goldSpent")
    vision_score: Optional[float] = Field(None, alias="visionScore")
    vision_wards_placed: int = Field(0, alias="detectorWardsPlaced")
    vision_wards_bought: int = Field(0, alias="visionWardsBoughtInGame")
    wards_placed: int = Field(0, alias="wardsPlaced")
    wards_killed: int = Field(0, alias="wardsKilled")

    # Farming
    total_minions_killed: int = Field(..., alias="totalMinionsKilled")
    neutral_minions_killed: int = Field(..., alias="neutralMinionsKilled")

    # Damage
    total_damage_dealt: int = Field(0, alias="totalDamageDealt")
    total_damage_dealt_to_champions: int = Field(
        ..., alias="totalDamageDealtToChampions"
    )
    physical_damage_dealt_to_champions: int = Field(
        0, alias="physicalDamageDealtToChampions"
    )
    magic_damage_dealt_to_champions: int = Field(0, alias="magicDamageDealtToChampions")
    true_damage_dealt_to_champions: int = Field(0, alias="trueDamageDealtToChampions")
    damage_dealt_to_objectives: int = Field(0, alias="damageDealtToObjectives")
    damage_dealt_to_turrets: int = Field(0, alias="damageDealtToTurrets")

    total_damage_taken: int = Field(..., alias="totalDamageTaken")
    physical_damage_taken: int = Field(0, alias="physicalDamageTaken")
    magic_damage_taken: int = Field(0, alias="magicDamageTaken")
    true_damage_taken: int = Field(0, alias="trueDamageTaken")

    # Healing & Shielding
    total_self_healing: int = Field(0, alias="totalHeal")
    total_healing: int = Field(0, alias="totalHealsOnTeammates")
    total_shielding: int = Field(0, alias="totalDamageShieldedOnTeammates")
    total_self_mitigated: int = Field(0, alias="damageSelfMitigated")

    # Items
    item0: int = Field(0)
    item1: int = Field(0)
    item2: int = Field(0)
    item3: int = Field(0)
    item4: int = Field(0)
    item5: int = Field(0)
    trinket: int = Field(0, alias="item6")
    items_purchased: int = Field(0, alias="itemsPurchased")
    consumables_purchased: int = Field(0, alias="consumablesPurchased")
    role_bound_item: int = Field(0, alias="roleBoundItem")

    # Spells/Objectives/Time
    summoner1_id: int = Field(0, alias="summoner1Id")
    summoner1_casts: int = Field(0, alias="summoner1Casts")
    summoner2_id: int = Field(0, alias="summoner2Id")
    summoner2_casts: int = Field(0, alias="summoner2Casts")

    turret_kills: int = Field(0, alias="turretKills")
    inhibitor_kills: int = Field(0, alias="inhibitorKills")
    objectives_stolen: int = Field(0, alias="objectivesStolen")

    time_spent_dead: int = Field(0, alias="totalTimeSpentDead")
    time_played: int = Field(0, alias="timePlayed")

    # Flags
    eligible_for_progression: bool = Field(True, alias="eligibleForProgression")
    game_ended_in_early_surrender: Optional[bool] = Field(
        None, alias="gameEndedInEarlySurrender"
    )
    game_ended_in_surrender: Optional[bool] = Field(None, alias="gameEndedInSurrender")

    @property
    def remake(self) -> bool:
        """Remake is the negation of eligibleForProgression."""
        return not self.eligible_for_progression

    # Advanced

    # Advanced
    runes: dict = Field(default_factory=dict, alias="perks")
    advanced_stats: dict = Field(default_factory=dict, alias="challenges")

    # Legacy / Unused in new schema but kept for completeness or other uses
    role: Optional[str] = None
    individual_position: Optional[str] = Field(None, alias="individualPosition")

    @property
    def calculated_kda(self) -> float:
        """Calculate KDA (kills + assists) / deaths."""
        if self.deaths == 0:
            return self.kills + self.assists
        return (self.kills + self.assists) / self.deaths

    model_config = ConfigDict(populate_by_name=True)


class MatchInfoDTO(BaseModel):
    """Match information."""

    game_start_timestamp: int = Field(..., alias="gameCreation")
    game_duration: int = Field(..., alias="gameDuration")
    queue_id: int = Field(..., alias="queueId")
    map_id: int = Field(..., alias="mapId")
    game_version: str = Field(..., alias="gameVersion")
    game_mode: str = Field(..., alias="gameMode")
    game_type: str = Field(..., alias="gameType")
    game_end_timestamp: Optional[int] = Field(None, alias="gameEndTimestamp")
    game_result: Optional[str] = Field(None, alias="endOfGameResult")
    participants: List[ParticipantDTO]
    platform: str = Field(..., alias="platformId")

    model_config = ConfigDict(populate_by_name=True)


class MatchMetadataDTO(BaseModel):
    """Match metadata."""

    match_id: str = Field(..., alias="matchId")
    participants: List[str]

    model_config = ConfigDict(populate_by_name=True)


class MatchDTO(BaseModel):
    """Complete match data."""

    metadata: MatchMetadataDTO
    info: MatchInfoDTO

    @property
    def match_id(self) -> str:
        """Get match ID from metadata."""
        return self.metadata.match_id

    model_config = ConfigDict(populate_by_name=True)


class LeagueEntryDTO(BaseModel):
    """League entry information."""

    league_id: str = Field(..., alias="leagueId")
    summoner_id: str = Field(..., alias="summonerId")
    summoner_name: str = Field(..., alias="summonerName")
    queue_type: str = Field(..., alias="queueType")
    tier: str
    rank: str
    league_points: int = Field(..., alias="leaguePoints")
    wins: int
    losses: int
    veteran: bool = Field(..., alias="veteran")
    inactive: bool = Field(..., alias="inactive")
    fresh_blood: bool = Field(..., alias="freshBlood")
    hot_streak: bool = Field(..., alias="hotStreak")

    @property
    def win_rate(self) -> float:
        """Calculate win rate."""
        total_games = self.wins + self.losses
        if total_games == 0:
            return 0
        return (self.wins / total_games) * 100

    model_config = ConfigDict(populate_by_name=True)
