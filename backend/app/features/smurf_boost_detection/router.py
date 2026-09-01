"""HTTP surface for smurf and boost detection."""

from __future__ import annotations

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request

from app.core.http_rate_limit import rate_limit
from app.features.auth.dependencies import get_current_active_user
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

# Neither is the caller's fault: an in-flight run is a retryable conflict, and
# a run that cannot be read back after writing is a server invariant failure.
ERROR_STATUS_CODES = {"analysis_in_progress": 409, "analysis_missing": 500}

logger = structlog.get_logger(__name__)


router = APIRouter(
    prefix="/smurf-boost-detection",
    tags=["smurf-boost-detection"],
    dependencies=[Depends(get_current_active_user)],
)


@router.get("/presets")
def get_presets() -> PresetsResponse:
    """List the named threshold presets and the shipped default.

    Emitted in the card settings write contract's own field names and types, so
    a client can apply one by posting it straight back unreshaped.
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
) -> SmurfBoostAnalysisResponse:
    """Run detection for one player using the viewer's thresholds.

    The computation reads only stored rows, so it completes inside the request
    and never contacts the Riot API.
    """
    try:
        thresholds = await service.viewer_thresholds()
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
    """Read the caller's newest stored detection run for one player.

    Scoped to the caller by the service, not this signature: runs are scored
    against the viewer's own thresholds, so another account's run is wrong.
    """
    result = await service.get_latest(puuid)
    if not result:
        raise HTTPException(status_code=404, detail="No analysis found for this player")
    return result
