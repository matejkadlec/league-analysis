"""
Pydantic schemas for playstyle analysis API.
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from .models import AnalysisStatus, DetectedTag, SummaryStats


class PlaystyleAnalysisRequest(BaseModel):
    """Request for playstyle analysis."""

    puuid: str = Field(..., description="Player PUUID to analyze")
    force_reanalyze: bool = Field(
        default=False, description="Force reanalysis even if recent analysis exists"
    )


class PlaystyleAnalysisResponse(BaseModel):
    """Response from playstyle analysis."""

    id: int
    puuid: str
    status: AnalysisStatus
    tags: dict[str, DetectedTag] = Field(
        ..., description="Detected playstyle tags, keyed by tag code"
    )
    summary_stats: SummaryStats | None = Field(
        ..., description="Summary statistics, null when the player had no matches"
    )
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
