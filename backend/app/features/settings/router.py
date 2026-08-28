"""Settings API endpoints for managing system configuration."""

import structlog
from fastapi import APIRouter, HTTPException

from app.features.auth.dependencies import AdminUserDep, CurrentUserDep
from app.features.auth.user_cookie_consent import UserCookieConsent

from .dependencies import SettingsServiceDep
from .schemas import (
    CardId,
    CardPreferenceResponse,
    CardPreferenceUpdate,
    ServiceStatusResponse,
    SettingResponse,
    SettingTestResponse,
    SettingUpdate,
    UserCookieConsentResponse,
    UserCookieConsentUpdate,
)

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("/service-status")
async def get_service_status(
    settings_service: SettingsServiceDep,
    _current_user: CurrentUserDep,
) -> ServiceStatusResponse:
    """Get user-facing maintenance status."""
    return await settings_service.get_service_status()


@router.get("/riot_api_key")
async def get_riot_api_key(
    settings_service: SettingsServiceDep,
    _current_user: AdminUserDep,
) -> SettingResponse:
    """Get current Riot API key (value is masked for security)."""
    setting = await settings_service.get_setting("riot_api_key")

    if not setting:
        raise HTTPException(
            status_code=404,
            detail="No Riot API key has been saved yet.",
        )

    return setting


@router.put("/riot_api_key")
async def update_riot_api_key(
    update: SettingUpdate,
    settings_service: SettingsServiceDep,
    _current_user: AdminUserDep,
) -> SettingResponse:
    """
    Update the Riot API key.

    The key is validated against the Riot API before being saved. A database-backed
    key takes effect immediately; an environment-backed one needs a restart.
    """
    try:
        # No first-store branch: `update_setting` creates the key row when the
        # value has never been seen, so the extra SELECT decided nothing and
        # both arms called the same method.
        setting = await settings_service.update_setting("riot_api_key", update)

        logger.info(
            "riot_api_key_updated",
            masked_value=setting.masked_value,
        )

        return setting

    except ValueError as e:
        logger.warning("riot_api_key_validation_failed", error=str(e))
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/riot_api_key/test")
async def test_riot_api_key(
    update: SettingUpdate,
    settings_service: SettingsServiceDep,
    _current_user: AdminUserDep,
) -> SettingTestResponse:
    """
    Test a Riot API key without saving it.

    Validates the key with a test request to the Riot API; nothing is stored.
    """
    test_result = await settings_service.test_riot_api_key(update.value)

    logger.info(
        "riot_api_key_tested",
        success=test_result.success,
        message=test_result.message,
    )

    return test_result


# ===== CARD PREFERENCE ENDPOINTS =====


@router.get(
    "/card-preferences",
)
async def get_card_preferences(
    settings_service: SettingsServiceDep,
    current_user: CurrentUserDep,
) -> list[CardPreferenceResponse]:
    """Return the authenticated viewer's effective settings for every v1 card."""
    return await settings_service.get_card_preferences(current_user.id)


@router.put(
    "/card-preferences/{card_id}",
)
async def update_card_preference(
    card_id: CardId,
    update: CardPreferenceUpdate,
    settings_service: SettingsServiceDep,
    current_user: CurrentUserDep,
) -> CardPreferenceResponse:
    """Atomically replace one complete, validated v1 override for this viewer."""
    try:
        return await settings_service.update_card_preference(
            current_user.id, card_id, update
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.delete(
    "/card-preferences/{card_id}",
)
async def reset_card_preference(
    card_id: CardId,
    settings_service: SettingsServiceDep,
    current_user: CurrentUserDep,
) -> CardPreferenceResponse:
    """Remove the viewer's v1 override for one card and return its defaults."""
    return await settings_service.reset_card_preference(current_user.id, card_id)


@router.get("/user/cookie-consent", response_model=UserCookieConsentResponse | None)
async def get_user_cookie_consent(
    settings_service: SettingsServiceDep,
    current_user: CurrentUserDep,
) -> UserCookieConsent | None:
    """Get authenticated user's latest cookie-consent selection."""
    return await settings_service.get_user_cookie_consent(current_user.id)


@router.put("/user/cookie-consent", response_model=UserCookieConsentResponse)
async def update_user_cookie_consent(
    update: UserCookieConsentUpdate,
    settings_service: SettingsServiceDep,
    current_user: CurrentUserDep,
) -> UserCookieConsent:
    """Create or update authenticated user's cookie-consent selection."""
    return await settings_service.upsert_user_cookie_consent(current_user.id, update)
