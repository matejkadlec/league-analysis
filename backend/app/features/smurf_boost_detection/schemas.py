"""API contracts for smurf and boost detection."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

SmurfBoostStatus = Literal["pending", "in_progress", "completed", "failed"]

# The one-active-run interlock's statuses; the partial unique index on
# `smurf_boost_analyses` renders from this tuple, so extending it is DDL.
ACTIVE_STATUSES: tuple[SmurfBoostStatus, ...] = ("pending", "in_progress")

SmurfBoostBand = Literal[
    "not_enough_data",
    "no_unusual_pattern",
    "weak_indicators",
    "notable_indicators",
    "strong_indicators",
]

ConfidenceBand = Literal["low", "medium", "high"]

DISCLAIMER = (
    "This is a statistical comparison of a player's recent ranked games against "
    "their own earlier games. It is not evidence of smurfing, boosting, or "
    "account sharing, and it cannot distinguish improvement from any other "
    "explanation. Do not use it to accuse anyone."
)


class SmurfBoostAnalysisRequest(BaseModel):
    """Request body for starting a detection run."""

    puuid: str = Field(..., min_length=1, max_length=78)


class SignalPayload(BaseModel):
    """One signal's explainable outcome as returned to a client."""

    id: str
    family: str
    available: bool
    triggered: bool
    sample_size: int
    reason: str
    notes: list[str]
    raw_value: float | None = None
    threshold: float | None = None
    saturation: float | None = None
    magnitude: float | None = None
    weight: float | None = None
    contribution: float | None = None


class FamilyPayload(BaseModel):
    """One indicator family's band and its contributing signals.

    The weighted sum that produced the band is deliberately absent: the
    specification forbids showing a per-family number.
    """

    family: str
    band: SmurfBoostBand
    distinct_evidence: int
    signals: list[SignalPayload]


class SmurfBoostResults(BaseModel):
    """The explained model output for one completed run."""

    model_config = ConfigDict(protected_namespaces=())

    model_version: str
    families: list[FamilyPayload]
    confidence: float
    confidence_band: ConfidenceBand
    recent_games: int
    baseline_games: int
    eligible_games: int
    notes: list[str]
    disclaimer: str = DISCLAIMER


class SmurfBoostAnalysisResponse(BaseModel):
    """A persisted detection run in any lifecycle state."""

    model_config = ConfigDict(from_attributes=True, protected_namespaces=())

    puuid: str
    created_at: datetime
    status: SmurfBoostStatus
    model_version: str
    thresholds: dict[str, float]
    results: SmurfBoostResults | None = None
    eligible_games: int
    latest_match_id: str | None = None
    error_code: str | None = None
    error_message: str | None = None
    completed_at: datetime | None = None
    is_stale: bool = False


class PresetPayload(BaseModel):
    """One named threshold preset, in the settings write contract's own shape.

    Window sizes stay JSON integers because the settings API rejects a coerced
    float, and the field names are the canonical API names for the same reason.
    """

    name: str
    thresholds: dict[str, float | int]


class PresetsResponse(BaseModel):
    """Every named preset plus the shipped default."""

    default_preset: str
    presets: list[PresetPayload]
