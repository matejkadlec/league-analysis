"""HTTP surface for smurf and boost detection."""

from __future__ import annotations

from collections.abc import Callable
from typing import ParamSpec, Protocol, TypeVar

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.features.auth.dependencies import get_current_active_user
from app.features.auth.models import User
from app.features.settings.models import UserCardPreference
from app.features.settings.schemas import CardId, serialize_card_preference_settings

from .config import DEFAULT_PRESET, PRESETS
from .dependencies import SmurfBoostServiceDep
from .schemas import (
    PresetPayload,
    PresetsResponse,
    SmurfBoostAnalysisRequest,
    SmurfBoostAnalysisResponse,
)
from .service import SmurfBoostDetectionError, resolve_thresholds

# A run already in flight under different settings is a retryable conflict, not
# a malformed request, so it must not be reported as a validation failure. A run
# that cannot be read back after it was written is a server-side invariant
# failure, and blaming the caller's valid payload for it would be wrong.
ERROR_STATUS_CODES = {"analysis_in_progress": 409, "analysis_missing": 500}

limiter = Limiter(key_func=get_remote_address)
logger = structlog.get_logger(__name__)

_P = ParamSpec("_P")
_R = TypeVar("_R")


class _RateLimiter(Protocol):
    """The one slowapi capability this module uses, with a usable signature.

    slowapi annotates the decorator `limit` returns as a bare `Callable`, which
    erases the parameter and return types of every endpoint underneath it.
    """

    def limit(
        self, limit_value: str
    ) -> Callable[[Callable[_P, _R]], Callable[_P, _R]]: ...


def rate_limit(
    rule: str, rate_limiter: _RateLimiter = limiter
) -> Callable[[Callable[_P, _R]], Callable[_P, _R]]:
    """Apply slowapi's rate limit while keeping the endpoint's own signature."""
    return rate_limiter.limit(rule)


router = APIRouter(
    prefix="/smurf-boost-detection",
    tags=["smurf-boost-detection"],
    dependencies=[Depends(get_current_active_user)],
)


async def _viewer_thresholds(db: AsyncSession, user_id: int) -> dict[str, float]:
    """Resolve the signed-in viewer's stored thresholds over the defaults."""
    result = await db.execute(
        select(UserCardPreference.settings).where(
            UserCardPreference.user_id == user_id,
            UserCardPreference.card_id == CardId.SMURF_BOOST_DETECTION.value,
            UserCardPreference.version == 1,
        )
    )
    return resolve_thresholds(result.scalar_one_or_none())


@router.get("/presets", response_model=PresetsResponse)
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


@router.post("/analyze", response_model=SmurfBoostAnalysisResponse)
@rate_limit("20/minute")
async def analyze_player(
    request: Request,
    payload: SmurfBoostAnalysisRequest,
    service: SmurfBoostServiceDep,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> SmurfBoostAnalysisResponse:
    """Run detection for one player using the viewer's thresholds.

    The computation reads only stored rows, so it completes inside the request
    and never contacts the Riot API.
    """
    try:
        thresholds = await _viewer_thresholds(db, current_user.id)
        return await service.run_analysis(payload.puuid, thresholds)
    except HTTPException:
        raise
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
    except Exception as error:
        logger.error(
            "smurf_boost_analysis_start_failed",
            error_type=type(error).__name__,
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail="The analysis could not be started. Please try again.",
        ) from error


@router.get("/player/{puuid}", response_model=SmurfBoostAnalysisResponse)
async def get_latest_analysis(
    puuid: str, service: SmurfBoostServiceDep
) -> SmurfBoostAnalysisResponse:
    """Read the newest stored detection run for one player."""
    result = await service.get_latest(puuid)
    if not result:
        raise HTTPException(status_code=404, detail="No analysis found for this player")
    return result
