"""HTTP surface for smurf and boost detection."""

from __future__ import annotations

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request

from app.core.rate_limiter import rate_limit
from app.features.auth.dependencies import (
    CurrentUserDep,
    get_current_active_user,
)
from app.features.settings.schemas import serialize_card_preference_settings

from .config import DEFAULT_PRESET, PRESETS
from .dependencies import SmurfBoostServiceDep
from .schemas import (
    PresetPayload,
    PresetsResponse,
    SmurfBoostAnalysisRequest,
    SmurfBoostAnalysisResponse,
)
from .service import SmurfBoostDetectionError

# A run already in flight under different settings is a retryable conflict, not
# a malformed request, so it must not be reported as a validation failure. A run
# that cannot be read back after it was written is a server-side invariant
# failure, and blaming the caller's valid payload for it would be wrong.
ERROR_STATUS_CODES = {"analysis_in_progress": 409, "analysis_missing": 500}

logger = structlog.get_logger(__name__)


router = APIRouter(
    prefix="/smurf-boost-detection",
    tags=["smurf-boost-detection"],
    dependencies=[Depends(get_current_active_user)],
)


@router.get("/presets")
async def get_presets() -> PresetsResponse:
    """List the named threshold presets and the shipped default.

    Each preset is emitted in the card settings write contract's own field
    names and numeric types, so a client can apply one by posting it straight
    back to the settings API without reshaping it.
    """
    return PresetsResponse(
        default_preset=DEFAULT_PRESET,
        presets=[
            PresetPayload(
                name=name,
                thresholds=serialize_card_preference_settings(dict(thresholds)),
            )
            for name, thresholds in PRESETS.items()
        ],
    )


@router.post("/analyze")
@rate_limit("20/minute")
async def analyze_player(
    request: Request,
    payload: SmurfBoostAnalysisRequest,
    service: SmurfBoostServiceDep,
    current_user: CurrentUserDep,
) -> SmurfBoostAnalysisResponse:
    """Run detection for one player using the viewer's thresholds.

    The computation reads only stored rows, so it completes inside the request
    and never contacts the Riot API.
    """
    try:
        thresholds = await service.viewer_thresholds(current_user.id)
        return await service.run_analysis(payload.puuid, thresholds)
    except SmurfBoostDetectionError as error:
        logger.warning(
            "smurf_boost_analysis_rejected",
            error_type=type(error).__name__,
            error_code=error.code,
        )
        raise HTTPException(
            status_code=ERROR_STATUS_CODES.get(error.code, 422),
            detail=error.client_message,
        ) from error


@router.get("/player/{puuid}")
async def get_latest_analysis(
    puuid: str, service: SmurfBoostServiceDep
) -> SmurfBoostAnalysisResponse:
    """Read the newest stored detection run for one player."""
    result = await service.get_latest(puuid)
    if not result:
        raise HTTPException(status_code=404, detail="No analysis found for this player")
    return result
