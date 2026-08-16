"""Pydantic models for Riot API response data."""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class AccountDTO(BaseModel):
    """Riot Account information."""

    puuid: str
    game_name: str | None = Field(default=None, alias="gameName")
    tag_line: str | None = Field(default=None, alias="tagLine")

    model_config = ConfigDict(populate_by_name=True)


class SummonerDTO(BaseModel):
    """League of Legends Summoner information."""

    id: str | None = None
    puuid: str
    name: str | None = None
    profile_icon_id: int = Field(..., alias="profileIconId")
    summoner_level: int = Field(..., alias="summonerLevel")

    model_config = ConfigDict(populate_by_name=True)


class MatchListDTO(BaseModel):
    """Match list response."""

    match_ids: list[str] = Field(..., alias="matchIds")
    start: int
    count: int
    total: int | None = None
    puuid: str | None = None

    model_config = ConfigDict(populate_by_name=True)


class ParticipantDTO(BaseModel):
    """Match participant information."""

    # Core IDs
    participant_id: int = Field(..., alias="participantId")
    puuid: str
    summoner_name: str | None = Field(default=None, alias="summonerName")
    summoner_id: str | None = Field(default=None, alias="summonerId")
    summoner_level: int = Field(default=0, alias="summonerLevel")
    profile_icon: int = Field(default=0, alias="profileIcon")

    # Riot ID fields
    game_name: str | None = Field(default=None, alias="riotIdGameName")
    tag_line: str | None = Field(default=None, alias="riotIdTagline")

    # Team & Position
    team_id: int = Field(..., alias="teamId")
    team_position: str | None = Field(default=None, alias="teamPosition")

    # Champions
    champion_id: int = Field(..., alias="championId")
    champion_name: str = Field(..., alias="championName")
    champion_level: int = Field(..., alias="champLevel")
    champion_transform: int = Field(default=0, alias="championTransform")

    # KDA & Perf
    win: bool
    kills: int
    deaths: int
    assists: int
    kda: float = Field(
        default=0.0
    )  # Calculated property in API, but explicit here for validation

    largest_multi_kill: int = Field(default=0, alias="largestMultiKill")
    largest_killing_spree: int = Field(default=0, alias="largestKillingSpree")
    first_blood_kill: bool = Field(default=False, alias="firstBloodKill")
    first_tower_kill: bool = Field(default=False, alias="firstTowerKill")

    # Economy & Vision
    gold_earned: int = Field(default=0, alias="goldEarned")
    gold_spent: int = Field(default=0, alias="goldSpent")
    vision_score: float | None = Field(default=None, alias="visionScore")
    vision_wards_placed: int = Field(default=0, alias="detectorWardsPlaced")
    vision_wards_bought: int = Field(default=0, alias="visionWardsBoughtInGame")
    wards_placed: int = Field(default=0, alias="wardsPlaced")
    wards_killed: int = Field(default=0, alias="wardsKilled")

    # Farming
    total_minions_killed: int = Field(default=0, alias="totalMinionsKilled")
    neutral_minions_killed: int = Field(default=0, alias="neutralMinionsKilled")

    # Damage
    total_damage_dealt: int = Field(default=0, alias="totalDamageDealt")
    total_damage_dealt_to_champions: int = Field(
        default=0, alias="totalDamageDealtToChampions"
    )
    physical_damage_dealt_to_champions: int = Field(
        default=0, alias="physicalDamageDealtToChampions"
    )
    magic_damage_dealt_to_champions: int = Field(
        default=0, alias="magicDamageDealtToChampions"
    )
    true_damage_dealt_to_champions: int = Field(
        default=0, alias="trueDamageDealtToChampions"
    )
    damage_dealt_to_objectives: int = Field(default=0, alias="damageDealtToObjectives")
    damage_dealt_to_turrets: int = Field(default=0, alias="damageDealtToTurrets")

    total_damage_taken: int = Field(default=0, alias="totalDamageTaken")
    physical_damage_taken: int = Field(default=0, alias="physicalDamageTaken")
    magic_damage_taken: int = Field(default=0, alias="magicDamageTaken")
    true_damage_taken: int = Field(default=0, alias="trueDamageTaken")

    # Healing & Shielding
    total_self_healing: int = Field(default=0, alias="totalHeal")
    total_healing: int = Field(default=0, alias="totalHealsOnTeammates")
    total_shielding: int = Field(default=0, alias="totalDamageShieldedOnTeammates")
    total_self_mitigated: int = Field(default=0, alias="damageSelfMitigated")

    # Items
    item0: int = Field(default=0)
    item1: int = Field(default=0)
    item2: int = Field(default=0)
    item3: int = Field(default=0)
    item4: int = Field(default=0)
    item5: int = Field(default=0)
    trinket: int = Field(default=0, alias="item6")
    items_purchased: int = Field(default=0, alias="itemsPurchased")
    consumables_purchased: int = Field(default=0, alias="consumablesPurchased")
    role_bound_item: int = Field(default=0, alias="roleBoundItem")

    # Spells/Objectives/Time
    summoner1_id: int = Field(default=0, alias="summoner1Id")
    summoner1_casts: int = Field(default=0, alias="summoner1Casts")
    summoner2_id: int = Field(default=0, alias="summoner2Id")
    summoner2_casts: int = Field(default=0, alias="summoner2Casts")

    turret_kills: int = Field(default=0, alias="turretKills")
    inhibitor_kills: int = Field(default=0, alias="inhibitorKills")
    objectives_stolen: int = Field(default=0, alias="objectivesStolen")

    time_spent_dead: int = Field(default=0, alias="totalTimeSpentDead")
    time_played: int = Field(default=0, alias="timePlayed")

    # Flags
    eligible_for_progression: bool = Field(default=True, alias="eligibleForProgression")
    game_ended_in_early_surrender: bool | None = Field(
        default=None, alias="gameEndedInEarlySurrender"
    )
    game_ended_in_surrender: bool | None = Field(
        default=None, alias="gameEndedInSurrender"
    )

    @property
    def remake(self) -> bool:
        """Remake is the negation of eligibleForProgression."""
        return not self.eligible_for_progression

    # Advanced

    # Advanced
    runes: dict[str, Any] = Field(default_factory=dict, alias="perks")
    advanced_stats: dict[str, Any] = Field(default_factory=dict, alias="challenges")

    # Legacy / Unused in new schema but kept for completeness or other uses
    role: str | None = None
    individual_position: str | None = Field(default=None, alias="individualPosition")

    @property
    def calculated_kda(self) -> float:
        """Calculate KDA (kills + assists) / deaths."""
        if self.deaths == 0:
            return self.kills + self.assists
        return (self.kills + self.assists) / self.deaths

    model_config = ConfigDict(populate_by_name=True)


class MatchInfoDTO(BaseModel):
    """Match information."""

    game_creation_timestamp: int = Field(..., alias="gameCreation")
    game_start_timestamp: int = Field(..., alias="gameStartTimestamp")
    game_duration: int = Field(..., alias="gameDuration")
    queue_id: int = Field(..., alias="queueId")
    map_id: int = Field(..., alias="mapId")
    game_version: str = Field(..., alias="gameVersion")
    game_mode: str = Field(..., alias="gameMode")
    game_type: str = Field(..., alias="gameType")
    game_end_timestamp: int | None = Field(default=None, alias="gameEndTimestamp")
    game_result: str | None = Field(default=None, alias="endOfGameResult")
    participants: list[ParticipantDTO]
    platform: str = Field(..., alias="platformId")

    model_config = ConfigDict(populate_by_name=True)


class MatchMetadataDTO(BaseModel):
    """Match metadata."""

    match_id: str = Field(..., alias="matchId")
    participants: list[str]

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
    """Current LEAGUE-V4 by-PUUID entry."""

    # The live by-PUUID response can omit leagueId even though Riot's portal
    # still lists the field. Keep the remaining ranked fields strict.
    league_id: str | None = Field(default=None, alias="leagueId")
    # puuid can also be omitted because the requested PUUID is already in the path
    puuid: str | None = Field(default=None, alias="puuid")
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

    # miniSeries is intentionally ignored: no current feature displays or
    # analyzes promotion-series state, and Pydantic ignores extra provider keys.
    model_config = ConfigDict(populate_by_name=True, extra="ignore")


class LegacyLeagueEntryDTO(LeagueEntryDTO):
    """Legacy by-summoner response kept separate from the PUUID contract."""

    summoner_id: str | None = Field(default=None, alias="summonerId")
    summoner_name: str | None = Field(default=None, alias="summonerName")
