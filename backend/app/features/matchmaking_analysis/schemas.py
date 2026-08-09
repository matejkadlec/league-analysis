"""Schemas for matchmaking analysis requests and responses."""

from datetime import datetime
from typing import Dict, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, computed_field

MatchmakingAnalysisStatus = Literal[
    "pending",
    "in_progress",
    "waiting_rate_limit",
    "completed",
    "failed",
    "cancelled",
]


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
    results: Optional[MatchmakingAnalysisResults] = None
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    status: MatchmakingAnalysisStatus
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    puuid_progress: Optional[Dict[str, bool]] = None
    requests_saved: int = 0
    rate_limit_reset_at: Optional[datetime] = None

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


class MatchmakingAnalysisStatusResponse(BaseModel):
    """Quick status check response."""

    model_config = ConfigDict(from_attributes=True)

    puuid: str
    status: MatchmakingAnalysisStatus
    progress: int
    total_puuids: int
    results: Optional[MatchmakingAnalysisResults] = None
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    requests_saved: int = 0
    rate_limit_reset_at: Optional[datetime] = None


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


class NotEnoughMatchesResponse(BaseModel):
    """Response when player doesn't have enough matches."""

    message: str = "Player doesn't have enough matches for this analysis."
    matches_found: int
    matches_required: int = 10
