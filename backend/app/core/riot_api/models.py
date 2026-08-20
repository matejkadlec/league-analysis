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


# ---------------------------------------------------------------------------
# Match-V5 timeline
#
# Generated from Riot's published OpenAPI specification rather than written by
# hand, and the slice these mirror is vendored at
# `tests/data/riot_match_v5_timeline_schema.json` so
# `test_timeline_dto_matches_riot_schema` can prove they still agree without a
# network call. Refresh both with `tests/data/refresh_timeline_schema.py`.
#
# Only the structural spine is required: metadata/info, frames, and each
# frame's timestamp and events. Every leaf is optional even where Riot's
# specification marks it required, because the specification is generated from
# a reference that is documented to carry "small errors or missing DTO specs",
# and this codebase has already been bitten by exactly that — see
# `LeagueEntryDTO.league_id` above. A ValidationError on a field nothing reads
# would be a regression against the `dict.get()` access this replaces.
class MatchTimelinePositionDTO(BaseModel):
    """A map coordinate."""

    x: int
    y: int

    model_config = ConfigDict(populate_by_name=True)


class MatchTimelineChampionStatsDTO(BaseModel):
    """Champion combat stats at one frame."""

    ability_haste: int | None = Field(default=None, alias="abilityHaste")
    ability_power: int | None = Field(default=None, alias="abilityPower")
    armor: int | None = Field(default=None)
    armor_pen: int | None = Field(default=None, alias="armorPen")
    armor_pen_percent: int | None = Field(default=None, alias="armorPenPercent")
    attack_damage: int | None = Field(default=None, alias="attackDamage")
    attack_speed: int | None = Field(default=None, alias="attackSpeed")
    bonus_armor_pen_percent: int | None = Field(
        default=None, alias="bonusArmorPenPercent"
    )
    bonus_magic_pen_percent: int | None = Field(
        default=None, alias="bonusMagicPenPercent"
    )
    cc_reduction: int | None = Field(default=None, alias="ccReduction")
    cooldown_reduction: int | None = Field(default=None, alias="cooldownReduction")
    health: int | None = Field(default=None)
    health_max: int | None = Field(default=None, alias="healthMax")
    health_regen: int | None = Field(default=None, alias="healthRegen")
    lifesteal: int | None = Field(default=None)
    magic_pen: int | None = Field(default=None, alias="magicPen")
    magic_pen_percent: int | None = Field(default=None, alias="magicPenPercent")
    magic_resist: int | None = Field(default=None, alias="magicResist")
    movement_speed: int | None = Field(default=None, alias="movementSpeed")
    omnivamp: int | None = Field(default=None)
    physical_vamp: int | None = Field(default=None, alias="physicalVamp")
    power: int | None = Field(default=None)
    power_max: int | None = Field(default=None, alias="powerMax")
    power_regen: int | None = Field(default=None, alias="powerRegen")
    spell_vamp: int | None = Field(default=None, alias="spellVamp")

    model_config = ConfigDict(populate_by_name=True)


class MatchTimelineDamageStatsDTO(BaseModel):
    """Cumulative damage totals at one frame."""

    magic_damage_done: int | None = Field(default=None, alias="magicDamageDone")
    magic_damage_done_to_champions: int | None = Field(
        default=None, alias="magicDamageDoneToChampions"
    )
    magic_damage_taken: int | None = Field(default=None, alias="magicDamageTaken")
    physical_damage_done: int | None = Field(default=None, alias="physicalDamageDone")
    physical_damage_done_to_champions: int | None = Field(
        default=None, alias="physicalDamageDoneToChampions"
    )
    physical_damage_taken: int | None = Field(default=None, alias="physicalDamageTaken")
    total_damage_done: int | None = Field(default=None, alias="totalDamageDone")
    total_damage_done_to_champions: int | None = Field(
        default=None, alias="totalDamageDoneToChampions"
    )
    total_damage_taken: int | None = Field(default=None, alias="totalDamageTaken")
    true_damage_done: int | None = Field(default=None, alias="trueDamageDone")
    true_damage_done_to_champions: int | None = Field(
        default=None, alias="trueDamageDoneToChampions"
    )
    true_damage_taken: int | None = Field(default=None, alias="trueDamageTaken")

    model_config = ConfigDict(populate_by_name=True)


class MatchTimelineVictimDamageDTO(BaseModel):
    """One damage contribution to a kill."""

    basic: bool | None = Field(default=None)
    magic_damage: int | None = Field(default=None, alias="magicDamage")
    name: str | None = Field(default=None)
    participant_id: int | None = Field(default=None, alias="participantId")
    physical_damage: int | None = Field(default=None, alias="physicalDamage")
    spell_name: str | None = Field(default=None, alias="spellName")
    spell_slot: int | None = Field(default=None, alias="spellSlot")
    true_damage: int | None = Field(default=None, alias="trueDamage")
    type: str | None = Field(default=None)

    model_config = ConfigDict(populate_by_name=True)


class MatchTimelineParticipantFrameDTO(BaseModel):
    """Per-participant state at one frame."""

    champion_stats: MatchTimelineChampionStatsDTO | None = Field(
        default=None, alias="championStats"
    )
    current_gold: int | None = Field(default=None, alias="currentGold")
    damage_stats: MatchTimelineDamageStatsDTO | None = Field(
        default=None, alias="damageStats"
    )
    gold_per_second: int | None = Field(default=None, alias="goldPerSecond")
    jungle_minions_killed: int | None = Field(default=None, alias="jungleMinionsKilled")
    level: int | None = Field(default=None)
    minions_killed: int | None = Field(default=None, alias="minionsKilled")
    participant_id: int | None = Field(default=None, alias="participantId")
    position: MatchTimelinePositionDTO | None = Field(default=None)
    time_enemy_spent_controlled: int | None = Field(
        default=None, alias="timeEnemySpentControlled"
    )
    total_gold: int | None = Field(default=None, alias="totalGold")
    xp: int | None = Field(default=None)

    model_config = ConfigDict(populate_by_name=True)


class MatchTimelineEventDTO(BaseModel):
    """A single timeline event.

    Events are polymorphic: Riot marks only `timestamp` and `type` as always
    present, and every other field belongs to a subset of event types."""

    timestamp: int
    real_timestamp: int | None = Field(default=None, alias="realTimestamp")
    type: str
    item_id: int | None = Field(default=None, alias="itemId")
    participant_id: int | None = Field(default=None, alias="participantId")
    level_up_type: str | None = Field(default=None, alias="levelUpType")
    skill_slot: int | None = Field(default=None, alias="skillSlot")
    creator_id: int | None = Field(default=None, alias="creatorId")
    ward_type: str | None = Field(default=None, alias="wardType")
    level: int | None = Field(default=None)
    assisting_participant_ids: list[int] | None = Field(
        default=None, alias="assistingParticipantIds"
    )
    bounty: int | None = Field(default=None)
    kill_streak_length: int | None = Field(default=None, alias="killStreakLength")
    killer_id: int | None = Field(default=None, alias="killerId")
    position: MatchTimelinePositionDTO | None = Field(default=None)
    victim_damage_dealt: list[MatchTimelineVictimDamageDTO] | None = Field(
        default=None, alias="victimDamageDealt"
    )
    victim_damage_received: list[MatchTimelineVictimDamageDTO] | None = Field(
        default=None, alias="victimDamageReceived"
    )
    victim_id: int | None = Field(default=None, alias="victimId")
    kill_type: str | None = Field(default=None, alias="killType")
    lane_type: str | None = Field(default=None, alias="laneType")
    team_id: int | None = Field(default=None, alias="teamId")
    multi_kill_length: int | None = Field(default=None, alias="multiKillLength")
    killer_team_id: int | None = Field(default=None, alias="killerTeamId")
    monster_type: str | None = Field(default=None, alias="monsterType")
    monster_sub_type: str | None = Field(default=None, alias="monsterSubType")
    building_type: str | None = Field(default=None, alias="buildingType")
    tower_type: str | None = Field(default=None, alias="towerType")
    after_id: int | None = Field(default=None, alias="afterId")
    before_id: int | None = Field(default=None, alias="beforeId")
    gold_gain: int | None = Field(default=None, alias="goldGain")
    game_id: int | None = Field(default=None, alias="gameId")
    winning_team: int | None = Field(default=None, alias="winningTeam")
    transform_type: str | None = Field(default=None, alias="transformType")
    name: str | None = Field(default=None)
    shutdown_bounty: int | None = Field(default=None, alias="shutdownBounty")
    actual_start_time: int | None = Field(default=None, alias="actualStartTime")
    feat_type: int | None = Field(default=None, alias="featType")
    feat_value: int | None = Field(default=None, alias="featValue")
    victim_teamfight_damage_dealt: list[MatchTimelineVictimDamageDTO] | None = Field(
        default=None, alias="victimTeamfightDamageDealt"
    )
    victim_teamfight_damage_received: list[MatchTimelineVictimDamageDTO] | None = Field(
        default=None, alias="victimTeamfightDamageReceived"
    )

    model_config = ConfigDict(populate_by_name=True)


class MatchTimelineFrameDTO(BaseModel):
    """One timeline frame (default interval 60s)."""

    events: list[MatchTimelineEventDTO]
    participant_frames: dict[int, MatchTimelineParticipantFrameDTO] | None = Field(
        default=None, alias="participantFrames"
    )
    timestamp: int

    model_config = ConfigDict(populate_by_name=True)


class MatchTimelineParticipantDTO(BaseModel):
    """Participant identity within the timeline."""

    participant_id: int = Field(..., alias="participantId")
    puuid: str

    model_config = ConfigDict(populate_by_name=True)


class MatchTimelineInfoDTO(BaseModel):
    """Timeline body: frames and participants."""

    end_of_game_result: str | None = Field(default=None, alias="endOfGameResult")
    frame_interval: int = Field(..., alias="frameInterval")
    game_id: int | None = Field(default=None, alias="gameId")
    participants: list[MatchTimelineParticipantDTO] | None = Field(default=None)
    frames: list[MatchTimelineFrameDTO]

    model_config = ConfigDict(populate_by_name=True)


class MatchTimelineMetadataDTO(BaseModel):
    """Timeline metadata."""

    data_version: str | None = Field(default=None, alias="dataVersion")
    match_id: str = Field(..., alias="matchId")
    participants: list[str]

    model_config = ConfigDict(populate_by_name=True)


class MatchTimelineDTO(BaseModel):
    """Match-V5 timeline response."""

    metadata: MatchTimelineMetadataDTO
    info: MatchTimelineInfoDTO

    model_config = ConfigDict(populate_by_name=True)
