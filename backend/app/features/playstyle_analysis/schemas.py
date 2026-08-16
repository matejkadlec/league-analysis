"""
Pydantic schemas for playstyle analysis API.
"""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from .models import AnalysisStatus


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
    tags: dict[str, Any] = Field(..., description="Detected playstyle tags")
    summary_stats: dict[str, Any] = Field(..., description="Summary statistics")
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
