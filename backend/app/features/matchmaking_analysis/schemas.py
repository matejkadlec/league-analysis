"""Schemas for matchmaking analysis requests and responses."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, computed_field

MatchmakingAnalysisStatus = Literal[
    "pending",
    "in_progress",
    "waiting_rate_limit",
    "completed",
    "failed",
    "cancelled",
]

# The statuses the one-active-run interlock holds over; the partial unique
# index on `matchmaking_analyses` is rendered from this tuple, so extending
# it is a schema change, not just a query change.
ACTIVE_ANALYSIS_STATUSES: tuple[MatchmakingAnalysisStatus, ...] = (
    "pending",
    "in_progress",
    "waiting_rate_limit",
)


class MatchmakingAnalysisRequest(BaseModel):
    """Request to start a matchmaking analysis."""

    puuid: str = Field(..., description="Player PUUID to analyze")


class MatchmakingAnalysisResults(BaseModel):
    """Results of matchmaking analysis."""

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


class MatchmakingAnalysisResponse(BaseModel):
    """Response containing matchmaking analysis data."""

    model_config = ConfigDict(from_attributes=True)

    puuid: str
    results: MatchmakingAnalysisResults | None = None
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
    status: MatchmakingAnalysisStatus
    error_code: str | None = None
    error_message: str | None = None
    # Excluded from the wire: the two computed fields below are all any
    # client has ever read, and the per-PUUID map is the only thing that made
    # the status response a second schema.
    puuid_progress: dict[str, bool] | None = Field(default=None, exclude=True)
    requests_saved: int = 0
    rate_limit_reset_at: datetime | None = None

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

    @computed_field
    @property
    def gap(self) -> float:
        """Winrate gap (positive = in favor of player's team)."""
        return self.team_avg_winrate - self.enemy_avg_winrate


class MatchmakingAnalysisHistoryResponse(BaseModel):
    """Response containing analysis history for a player."""

    model_config = ConfigDict(from_attributes=True)

    items: list[MatchmakingAnalysisHistoryItem]
