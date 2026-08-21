"""Pydantic models for Riot API response data."""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class RiotDTO(BaseModel):
    """Riot spells its JSON camelCase; these models spell their fields snake_case.

    The generator does that translation once. Only the fields where Riot's name
    is not simply the camelCase of ours still carry an explicit alias.
    """

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class AccountDTO(RiotDTO):
    """Riot Account information."""

    puuid: str
    game_name: str | None = Field(default=None)
    tag_line: str | None = Field(default=None)


class SummonerDTO(RiotDTO):
    """League of Legends Summoner information."""

    id: str | None = None
    puuid: str
    name: str | None = None
    profile_icon_id: int = Field(...)
    summoner_level: int = Field(...)


class MatchListDTO(RiotDTO):
    """Match list response."""

    match_ids: list[str] = Field(...)
    start: int
    count: int
    total: int | None = None
    puuid: str | None = None


class ParticipantDTO(RiotDTO):
    """Match participant information."""

    # Core IDs
    participant_id: int = Field(...)
    puuid: str
    summoner_name: str | None = Field(default=None)
    summoner_id: str | None = Field(default=None)
    summoner_level: int = Field(default=0)
    profile_icon: int = Field(default=0)

    # Riot ID fields
    game_name: str | None = Field(default=None, alias="riotIdGameName")
    tag_line: str | None = Field(default=None, alias="riotIdTagline")

    # Team & Position
    team_id: int = Field(...)
    team_position: str | None = Field(default=None)

    # Champions
    champion_id: int = Field(...)
    champion_name: str = Field(...)
    champion_level: int = Field(..., alias="champLevel")
    champion_transform: int = Field(default=0)

    # KDA & Perf
    win: bool
    kills: int
    deaths: int
    assists: int
    kda: float = Field(
        default=0.0
    )  # Calculated property in API, but explicit here for validation

    largest_multi_kill: int = Field(default=0)
    largest_killing_spree: int = Field(default=0)
    first_blood_kill: bool = Field(default=False)
    first_tower_kill: bool = Field(default=False)

    # Economy & Vision
    gold_earned: int = Field(default=0)
    gold_spent: int = Field(default=0)
    vision_score: float | None = Field(default=None)
    vision_wards_placed: int = Field(default=0, alias="detectorWardsPlaced")
    vision_wards_bought: int = Field(default=0, alias="visionWardsBoughtInGame")
    wards_placed: int = Field(default=0)
    wards_killed: int = Field(default=0)

    # Farming
    total_minions_killed: int = Field(default=0)
    neutral_minions_killed: int = Field(default=0)

    # Damage
    total_damage_dealt: int = Field(default=0)
    total_damage_dealt_to_champions: int = Field(default=0)
    physical_damage_dealt_to_champions: int = Field(default=0)
    magic_damage_dealt_to_champions: int = Field(default=0)
    true_damage_dealt_to_champions: int = Field(default=0)
    damage_dealt_to_objectives: int = Field(default=0)
    damage_dealt_to_turrets: int = Field(default=0)

    total_damage_taken: int = Field(default=0)
    physical_damage_taken: int = Field(default=0)
    magic_damage_taken: int = Field(default=0)
    true_damage_taken: int = Field(default=0)

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
    items_purchased: int = Field(default=0)
    consumables_purchased: int = Field(default=0)
    role_bound_item: int = Field(default=0)

    # Spells/Objectives/Time
    summoner1_id: int = Field(default=0)
    summoner1_casts: int = Field(default=0)
    summoner2_id: int = Field(default=0)
    summoner2_casts: int = Field(default=0)

    turret_kills: int = Field(default=0)
    inhibitor_kills: int = Field(default=0)
    objectives_stolen: int = Field(default=0)

    time_spent_dead: int = Field(default=0, alias="totalTimeSpentDead")
    time_played: int = Field(default=0)

    # Flags
    eligible_for_progression: bool = Field(default=True)
    game_ended_in_early_surrender: bool | None = Field(default=None)
    game_ended_in_surrender: bool | None = Field(default=None)

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
    individual_position: str | None = Field(default=None)


class MatchInfoDTO(RiotDTO):
    """Match information."""

    game_creation_timestamp: int = Field(..., alias="gameCreation")
    game_start_timestamp: int = Field(...)
    game_duration: int = Field(...)
    queue_id: int = Field(...)
    map_id: int = Field(...)
    game_version: str = Field(...)
    game_mode: str = Field(...)
    game_type: str = Field(...)
    # Required, because `core.matches.game_end_timestamp` is NOT NULL and this
    # value is written straight into it. Optional here only moved the refusal
    # from the trust boundary to a NOT NULL violation at flush.
    game_end_timestamp: int = Field(...)
    game_result: str | None = Field(default=None, alias="endOfGameResult")
    participants: list[ParticipantDTO]
    # `min_length=1`, so an empty `platformId` is refused here rather than
    # standing in for a real one. `upsert_match` used to substitute "EUN1",
    # which `normalize_platform` accepts without complaint -- a KR or NA
    # participant first seen through that path got `platform='eun1'` written
    # onto their player row, and every later Riot call for them was routed to
    # the wrong region forever. A rejected match is one recoverable failure;
    # a wrong platform is permanent and invisible.
    platform: str = Field(..., alias="platformId", min_length=1)


class MatchMetadataDTO(RiotDTO):
    """Match metadata."""

    match_id: str = Field(...)
    participants: list[str]


class MatchDTO(RiotDTO):
    """Complete match data."""

    metadata: MatchMetadataDTO
    info: MatchInfoDTO

    @property
    def match_id(self) -> str:
        """Get match ID from metadata."""
        return self.metadata.match_id


class LeagueEntryDTO(RiotDTO):
    """Current LEAGUE-V4 by-PUUID entry."""

    # The live by-PUUID response can omit leagueId even though Riot's portal
    # still lists the field. Keep the remaining ranked fields strict.
    league_id: str | None = Field(default=None)
    # puuid can also be omitted because the requested PUUID is already in the path
    puuid: str | None = Field(default=None, alias="puuid")
    queue_type: str = Field(...)
    tier: str
    rank: str
    league_points: int = Field(...)
    wins: int
    losses: int
    veteran: bool = Field(..., alias="veteran")
    inactive: bool = Field(..., alias="inactive")
    fresh_blood: bool = Field(...)
    hot_streak: bool = Field(...)

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
class MatchTimelinePositionDTO(RiotDTO):
    """A map coordinate."""

    x: int
    y: int


class MatchTimelineChampionStatsDTO(RiotDTO):
    """Champion combat stats at one frame."""

    ability_haste: int | None = Field(default=None)
    ability_power: int | None = Field(default=None)
    armor: int | None = Field(default=None)
    armor_pen: int | None = Field(default=None)
    armor_pen_percent: int | None = Field(default=None)
    attack_damage: int | None = Field(default=None)
    attack_speed: int | None = Field(default=None)
    bonus_armor_pen_percent: int | None = Field(default=None)
    bonus_magic_pen_percent: int | None = Field(default=None)
    cc_reduction: int | None = Field(default=None)
    cooldown_reduction: int | None = Field(default=None)
    health: int | None = Field(default=None)
    health_max: int | None = Field(default=None)
    health_regen: int | None = Field(default=None)
    lifesteal: int | None = Field(default=None)
    magic_pen: int | None = Field(default=None)
    magic_pen_percent: int | None = Field(default=None)
    magic_resist: int | None = Field(default=None)
    movement_speed: int | None = Field(default=None)
    omnivamp: int | None = Field(default=None)
    physical_vamp: int | None = Field(default=None)
    power: int | None = Field(default=None)
    power_max: int | None = Field(default=None)
    power_regen: int | None = Field(default=None)
    spell_vamp: int | None = Field(default=None)


class MatchTimelineDamageStatsDTO(RiotDTO):
    """Cumulative damage totals at one frame."""

    magic_damage_done: int | None = Field(default=None)
    magic_damage_done_to_champions: int | None = Field(default=None)
    magic_damage_taken: int | None = Field(default=None)
    physical_damage_done: int | None = Field(default=None)
    physical_damage_done_to_champions: int | None = Field(default=None)
    physical_damage_taken: int | None = Field(default=None)
    total_damage_done: int | None = Field(default=None)
    total_damage_done_to_champions: int | None = Field(default=None)
    total_damage_taken: int | None = Field(default=None)
    true_damage_done: int | None = Field(default=None)
    true_damage_done_to_champions: int | None = Field(default=None)
    true_damage_taken: int | None = Field(default=None)


class MatchTimelineVictimDamageDTO(RiotDTO):
    """One damage contribution to a kill."""

    basic: bool | None = Field(default=None)
    magic_damage: int | None = Field(default=None)
    name: str | None = Field(default=None)
    participant_id: int | None = Field(default=None)
    physical_damage: int | None = Field(default=None)
    spell_name: str | None = Field(default=None)
    spell_slot: int | None = Field(default=None)
    true_damage: int | None = Field(default=None)
    type: str | None = Field(default=None)


class MatchTimelineParticipantFrameDTO(RiotDTO):
    """Per-participant state at one frame."""

    champion_stats: MatchTimelineChampionStatsDTO | None = Field(default=None)
    current_gold: int | None = Field(default=None)
    damage_stats: MatchTimelineDamageStatsDTO | None = Field(default=None)
    gold_per_second: int | None = Field(default=None)
    jungle_minions_killed: int | None = Field(default=None)
    level: int | None = Field(default=None)
    minions_killed: int | None = Field(default=None)
    participant_id: int | None = Field(default=None)
    position: MatchTimelinePositionDTO | None = Field(default=None)
    time_enemy_spent_controlled: int | None = Field(default=None)
    total_gold: int | None = Field(default=None)
    xp: int | None = Field(default=None)


class MatchTimelineEventDTO(RiotDTO):
    """A single timeline event.

    Events are polymorphic: Riot marks only `timestamp` and `type` as always
    present, and every other field belongs to a subset of event types."""

    timestamp: int
    real_timestamp: int | None = Field(default=None)
    type: str
    item_id: int | None = Field(default=None)
    participant_id: int | None = Field(default=None)
    level_up_type: str | None = Field(default=None)
    skill_slot: int | None = Field(default=None)
    creator_id: int | None = Field(default=None)
    ward_type: str | None = Field(default=None)
    level: int | None = Field(default=None)
    assisting_participant_ids: list[int] | None = Field(default=None)
    bounty: int | None = Field(default=None)
    kill_streak_length: int | None = Field(default=None)
    killer_id: int | None = Field(default=None)
    position: MatchTimelinePositionDTO | None = Field(default=None)
    victim_damage_dealt: list[MatchTimelineVictimDamageDTO] | None = Field(default=None)
    victim_damage_received: list[MatchTimelineVictimDamageDTO] | None = Field(
        default=None
    )
    victim_id: int | None = Field(default=None)
    kill_type: str | None = Field(default=None)
    lane_type: str | None = Field(default=None)
    team_id: int | None = Field(default=None)
    multi_kill_length: int | None = Field(default=None)
    killer_team_id: int | None = Field(default=None)
    monster_type: str | None = Field(default=None)
    monster_sub_type: str | None = Field(default=None)
    building_type: str | None = Field(default=None)
    tower_type: str | None = Field(default=None)
    after_id: int | None = Field(default=None)
    before_id: int | None = Field(default=None)
    gold_gain: int | None = Field(default=None)
    game_id: int | None = Field(default=None)
    winning_team: int | None = Field(default=None)
    transform_type: str | None = Field(default=None)
    name: str | None = Field(default=None)
    shutdown_bounty: int | None = Field(default=None)
    actual_start_time: int | None = Field(default=None)
    feat_type: int | None = Field(default=None)
    feat_value: int | None = Field(default=None)
    victim_teamfight_damage_dealt: list[MatchTimelineVictimDamageDTO] | None = Field(
        default=None
    )
    victim_teamfight_damage_received: list[MatchTimelineVictimDamageDTO] | None = Field(
        default=None
    )


class MatchTimelineFrameDTO(RiotDTO):
    """One timeline frame (default interval 60s)."""

    events: list[MatchTimelineEventDTO]
    participant_frames: dict[int, MatchTimelineParticipantFrameDTO] | None = Field(
        default=None
    )
    timestamp: int


class MatchTimelineParticipantDTO(RiotDTO):
    """Participant identity within the timeline."""

    participant_id: int = Field(...)
    puuid: str


class MatchTimelineInfoDTO(RiotDTO):
    """Timeline body: frames and participants."""

    end_of_game_result: str | None = Field(default=None, alias="endOfGameResult")
    frame_interval: int = Field(...)
    game_id: int | None = Field(default=None)
    participants: list[MatchTimelineParticipantDTO] | None = Field(default=None)
    frames: list[MatchTimelineFrameDTO]


class MatchTimelineMetadataDTO(RiotDTO):
    """Timeline metadata."""

    data_version: str | None = Field(default=None)
    match_id: str = Field(...)
    participants: list[str]


class MatchTimelineDTO(RiotDTO):
    """Match-V5 timeline response."""

    metadata: MatchTimelineMetadataDTO
    info: MatchTimelineInfoDTO
