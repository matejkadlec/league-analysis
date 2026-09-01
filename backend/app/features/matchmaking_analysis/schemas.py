"""Schemas for matchmaking analysis requests and responses."""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, computed_field, field_validator

from app.core.enums import LobbyTier

MatchmakingAnalysisStatus = Literal[
    "pending",
    "in_progress",
    "waiting_rate_limit",
    "completed",
    "failed",
    "cancelled",
]

MatchmakingErrorCode = Literal[
    "not_enough_matches",
    "player_not_in_match",
    "no_matches_analyzed",
    "rate_limit_wait_exhausted",
    "RIOT_API_KEY_INVALID",
    "riot_service_error",
    "analysis_failed",
]

# The one-active-run interlock's statuses; the partial unique index on
# `matchmaking_analyses` renders from this tuple, so extending it is DDL.
ACTIVE_ANALYSIS_STATUSES: tuple[MatchmakingAnalysisStatus, ...] = (
    "pending",
    "in_progress",
    "waiting_rate_limit",
)

DEFAULT_MATCH_COUNT = 10
MIN_MATCH_COUNT = 10
MAX_MATCH_COUNT = 100


class MatchmakingAnalysisRequest(BaseModel):
    """Request to start a matchmaking analysis."""

    puuid: str = Field(..., description="Player PUUID to analyze")
    match_count: int = Field(
        default=DEFAULT_MATCH_COUNT,
        ge=MIN_MATCH_COUNT,
        le=MAX_MATCH_COUNT,
        description="Number of the player's ranked matches to analyze",
    )
    end_date: date | None = Field(
        default=None,
        description="Analyze the matches played on or before this day (UTC); "
        "omit for the latest matches",
    )


class MatchmakingAnalysisParams(BaseModel):
    """The parameters one run was started with, echoed on every read.

    Runs persisted before the `params` column existed were all 10-match
    latest-window runs, so that default is truthful, not a guess.
    """

    match_count: int = DEFAULT_MATCH_COUNT
    end_date: date | None = None


_LEGACY_PARAMS = MatchmakingAnalysisParams()


class MatchmakingPerMatchBreakdown(BaseModel):
    """Per-spine-match averages, kept so scopes can be recomputed client-side.

    Kill participation is deliberately unbounded above: Riot's challenge value
    can exceed 1.0 on shared kills.
    """

    match_id: str
    duo: bool
    win: bool | None = Field(
        default=None,
        description="Whether the analyzed player won this spine match",
    )
    ally_puuids: list[str] | None = Field(
        default=None,
        description="Allies of this spine match including the analyzed player",
    )
    enemy_puuids: list[str] | None = Field(
        default=None,
        description="Enemies of this spine match, for rank scoping",
    )
    team_avg: float = Field(..., ge=0.0, le=1.0)
    enemy_avg: float = Field(..., ge=0.0, le=1.0)
    team_kda: float | None = Field(default=None, ge=0.0)
    enemy_kda: float | None = Field(default=None, ge=0.0)
    team_kill_participation: float | None = Field(default=None, ge=0.0)
    enemy_kill_participation: float | None = Field(default=None, ge=0.0)
    team_damage_share: float | None = Field(default=None, ge=0.0, le=1.0)
    enemy_damage_share: float | None = Field(default=None, ge=0.0, le=1.0)


class MatchmakingPlayerRank(BaseModel):
    """One participant's rank at run time; value is None for UNRANKED."""

    tier: LobbyTier
    value: int | None = None


class MatchmakingRankFreshness(BaseModel):
    """How many participant ranks were measured near the analyzed period."""

    period_accurate: int = Field(..., ge=0)
    current_day: int = Field(..., ge=0)


class MatchmakingAnalysisResults(BaseModel):
    """Results of matchmaking analysis.

    Absent metrics default to None, never 0: a substituted 0 is indistinguishable
    from a real "0% average winrate".
    """

    team_avg_winrate: float = Field(
        ...,
        description="Average winrate of teammates",
        ge=0.0,
        le=1.0,
    )
    enemy_avg_winrate: float = Field(
        ...,
        description="Average winrate of enemies",
        ge=0.0,
        le=1.0,
    )
    matches_analyzed: int = Field(
        ...,
        description="Number of matches analyzed",
        ge=0,
    )
    matches_requested: int | None = Field(
        default=None,
        description="Spine size the run was asked for (params.match_count)",
    )
    spine_matches_found: int | None = Field(
        default=None,
        description="Spine matches actually found, <= matches_requested",
    )
    ally_avg_rank_value: float | None = Field(
        default=None,
        description="Mean LP-equivalent rank over unique ranked allies",
        ge=0.0,
    )
    enemy_avg_rank_value: float | None = Field(
        default=None,
        description="Mean LP-equivalent rank over unique ranked enemies",
        ge=0.0,
    )
    ally_tier_counts: dict[LobbyTier, int] | None = Field(
        default=None,
        description="Unique allies per tier, UNRANKED included",
    )
    enemy_tier_counts: dict[LobbyTier, int] | None = Field(
        default=None,
        description="Unique enemies per tier, UNRANKED included",
    )
    per_match: list[MatchmakingPerMatchBreakdown] | None = Field(
        default=None,
        description="Per-spine-match ally/enemy averages with the duo flag",
    )
    player_ranks: dict[str, MatchmakingPlayerRank] | None = Field(
        default=None,
        description="Rank per unique participant, keyed by puuid",
    )
    rank_freshness: MatchmakingRankFreshness | None = Field(
        default=None,
        description="Rank snapshot provenance counts for the honesty caption",
    )


def _params_or_legacy_default(value: object) -> object:
    """Map a NULL `params` column to the truthful legacy default."""
    return _LEGACY_PARAMS if value is None else value


class MatchmakingAnalysisResponse(BaseModel):
    """Response containing matchmaking analysis data."""

    model_config = ConfigDict(from_attributes=True)

    puuid: str
    results: MatchmakingAnalysisResults | None = None
    params: MatchmakingAnalysisParams = _LEGACY_PARAMS
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
    status: MatchmakingAnalysisStatus
    error_code: str | None = None
    error_message: str | None = None
    # Excluded from the wire: the two computed fields below are all any
    # client reads.
    puuid_progress: dict[str, bool] | None = Field(default=None, exclude=True)
    requests_saved: int = 0
    rate_limit_reset_at: datetime | None = None

    _default_params = field_validator("params", mode="before")(
        _params_or_legacy_default
    )

    @computed_field
    @property
    def progress(self) -> int:
        """Compute progress from puuid_progress."""
        if not self.puuid_progress:
            return 0
        return sum(1 for v in self.puuid_progress.values() if v)

    @computed_field
    @property
    def total_puuids(self) -> int:
        """Total number of PUUIDs to analyze."""
        if not self.puuid_progress:
            return 0
        return len(self.puuid_progress)


class MatchmakingAnalysisHistoryItem(BaseModel):
    """Single item in analysis history."""

    model_config = ConfigDict(from_attributes=True)

    created_at: datetime
    team_avg_winrate: float
    enemy_avg_winrate: float
    params: MatchmakingAnalysisParams = _LEGACY_PARAMS

    _default_params = field_validator("params", mode="before")(
        _params_or_legacy_default
    )

    @computed_field
    @property
    def gap(self) -> float:
        """Winrate gap (positive = in favor of player's team)."""
        return self.team_avg_winrate - self.enemy_avg_winrate


class MatchmakingAnalysisHistoryResponse(BaseModel):
    """Response containing analysis history for a player."""

    model_config = ConfigDict(from_attributes=True)

    items: list[MatchmakingAnalysisHistoryItem]
