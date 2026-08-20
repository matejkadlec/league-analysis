"""Settings API endpoints for managing system configuration."""

import structlog
from fastapi import APIRouter, Depends, HTTPException

from app.core.http_errors import log_and_raise_http
from app.features.auth.dependencies import (
    get_current_active_user,
    get_current_admin_user,
)
from app.features.auth.models import User

from .dependencies import SettingsServiceDep
from .schemas import (
    APIKeyStatusResponse,
    CardId,
    CardPreferenceResponse,
    CardPreferencesResetRequest,
    CardPreferenceUpdate,
    ServiceStatusResponse,
    SettingResponse,
    SettingTestResponse,
    SettingUpdate,
    UserCookieConsentResponse,
    UserCookieConsentUpdate,
    UserSettingsResponse,
    UserSettingsUpdate,
)

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("/riot_api_key/status", response_model=APIKeyStatusResponse)
async def get_riot_api_key_status(
    settings_service: SettingsServiceDep,
    _current_user: User = Depends(get_current_admin_user),
):
    """
    Get the status of the Riot API key configuration.
    Returns whether valid key exists in DB or Env, and which one is active.
    Used for UI header messages.
    """
    return await settings_service.get_api_key_status()


@router.get("/service-status", response_model=ServiceStatusResponse)
async def get_service_status(
    settings_service: SettingsServiceDep,
    _current_user: User = Depends(get_current_active_user),
):
    """Get user-facing maintenance status."""
    try:
        return await settings_service.get_service_status()
    except Exception as e:
        log_and_raise_http(
            logger,
            e,
            "failed_to_get_service_status",
        )


@router.get("/riot_api_key", response_model=SettingResponse)
async def get_riot_api_key(
    settings_service: SettingsServiceDep,
    _current_user: User = Depends(get_current_admin_user),
):
    """Get current Riot API key (value is masked for security)."""
    try:
        setting = await settings_service.get_setting("riot_api_key")

        if not setting:
            raise HTTPException(
                status_code=404,
                detail="No Riot API key has been saved here yet. The key from the server configuration is in use.",
            )

        return setting

    except HTTPException:
        raise
    except Exception as e:
        log_and_raise_http(
            logger,
            e,
            "failed_to_get_riot_api_key",
        )


@router.put("/riot_api_key", response_model=SettingResponse)
async def update_riot_api_key(
    update: SettingUpdate,
    settings_service: SettingsServiceDep,
    _current_user: User = Depends(get_current_admin_user),
):
    """
    Update the Riot API key.

    The new key is validated against the Riot API before being saved.
    If validation fails, the update is rejected.

    Database-backed changes take effect immediately. Environment-backed changes
    require updating the process environment and restarting the backend.
    """
    try:
        # Check if setting exists, create if not
        existing = await settings_service.get_setting("riot_api_key")

        if not existing:
            # Create the setting for the first time
            logger.info("creating_riot_api_key_setting")
            setting = await settings_service.create_or_update_setting(
                key="riot_api_key",
                value=update.value,
            )
        else:
            # Update existing setting
            setting = await settings_service.update_setting("riot_api_key", update)

        logger.info(
            "riot_api_key_updated",
            masked_value=setting.masked_value,
        )

        return setting

    except ValueError as e:
        # Validation failed
        logger.warning("riot_api_key_validation_failed", error=str(e))
        raise HTTPException(status_code=400, detail=str(e)) from e

    except Exception as e:
        log_and_raise_http(
            logger,
            e,
            "failed_to_update_riot_api_key",
        )


@router.post("/riot_api_key/test", response_model=SettingTestResponse)
async def test_riot_api_key(
    update: SettingUpdate,
    settings_service: SettingsServiceDep,
    _current_user: User = Depends(get_current_admin_user),
):
    """
    Test a Riot API key without saving it.

    This endpoint validates the provided API key by making a test
    request to the Riot API. The key is not saved to the database.

    Use this to verify a new key before committing the change.
    """
    try:
        test_result = await settings_service.test_riot_api_key(update.value)

        logger.info(
            "riot_api_key_tested",
            success=test_result.success,
            message=test_result.message,
        )

        return test_result

    except Exception as e:
        log_and_raise_http(
            logger,
            e,
            "failed_to_test_riot_api_key",
        )


# ===== USER SETTINGS ENDPOINTS =====


# ===== CARD PREFERENCE ENDPOINTS =====


@router.get(
    "/card-preferences",
    response_model=list[CardPreferenceResponse],
)
async def get_card_preferences(
    settings_service: SettingsServiceDep,
    current_user: User = Depends(get_current_active_user),
) -> list[CardPreferenceResponse]:
    """Return the authenticated viewer's effective settings for every v1 card."""
    try:
        return await settings_service.get_card_preferences(current_user.id)
    except Exception as error:
        log_and_raise_http(
            logger,
            error,
            "failed_to_get_card_preferences",
            error_type=type(error).__name__,
        )


@router.put(
    "/card-preferences/{card_id}",
    response_model=CardPreferenceResponse,
)
async def update_card_preference(
    card_id: CardId,
    update: CardPreferenceUpdate,
    settings_service: SettingsServiceDep,
    current_user: User = Depends(get_current_active_user),
) -> CardPreferenceResponse:
    """Atomically replace one complete, validated v1 override for this viewer."""
    try:
        return await settings_service.update_card_preference(
            current_user.id, card_id, update
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except Exception as error:
        log_and_raise_http(
            logger,
            error,
            "failed_to_update_card_preference",
            error_type=type(error).__name__,
        )


@router.delete(
    "/card-preferences/{card_id}",
    response_model=CardPreferenceResponse,
)
async def reset_card_preference(
    card_id: CardId,
    settings_service: SettingsServiceDep,
    current_user: User = Depends(get_current_active_user),
) -> CardPreferenceResponse:
    """Remove the viewer's v1 override for one card and return its defaults."""
    try:
        return await settings_service.reset_card_preference(current_user.id, card_id)
    except Exception as error:
        log_and_raise_http(
            logger,
            error,
            "failed_to_reset_card_preference",
            error_type=type(error).__name__,
        )


@router.post(
    "/card-preferences/reset",
    response_model=list[CardPreferenceResponse],
)
async def reset_all_card_preferences(
    confirmation: CardPreferencesResetRequest,
    settings_service: SettingsServiceDep,
    current_user: User = Depends(get_current_active_user),
) -> list[CardPreferenceResponse]:
    """Reset the complete current catalog after explicit client-side enumeration."""
    try:
        return await settings_service.reset_all_card_preferences(current_user.id)
    except Exception as error:
        log_and_raise_http(
            logger,
            error,
            "failed_to_reset_all_card_preferences",
            confirmed_card_count=len(confirmation.card_ids),
            error_type=type(error).__name__,
        )


@router.get("/user", response_model=UserSettingsResponse)
async def get_user_settings(
    settings_service: SettingsServiceDep,
    current_user: User = Depends(get_current_active_user),
):
    """
    Get the current user's settings.

    Returns the user's remaining application preferences. Player context is
    owned by the authenticated players API. Creates defaults if none exist.
    """
    try:
        settings = await settings_service.get_or_create_user_settings(current_user.id)
        return settings
    except Exception as e:
        log_and_raise_http(
            logger,
            e,
            "failed_to_get_user_settings",
        )


@router.put("/user", response_model=UserSettingsResponse)
async def update_user_settings(
    update: UserSettingsUpdate,
    settings_service: SettingsServiceDep,
    current_user: User = Depends(get_current_active_user),
):
    """
    Update the current user's settings.

    Only provided application-preference fields will be updated.
    """
    try:
        settings = await settings_service.update_user_settings(current_user.id, update)
        return settings
    except Exception as e:
        log_and_raise_http(
            logger,
            e,
            "failed_to_update_user_settings",
        )


@router.get("/user/cookie-consent", response_model=UserCookieConsentResponse | None)
async def get_user_cookie_consent(
    settings_service: SettingsServiceDep,
    current_user: User = Depends(get_current_active_user),
):
    """Get authenticated user's latest cookie-consent selection."""
    try:
        consent = await settings_service.get_user_cookie_consent(current_user.id)
        return consent
    except Exception as e:
        log_and_raise_http(
            logger,
            e,
            "failed_to_get_user_cookie_consent",
        )


@router.put("/user/cookie-consent", response_model=UserCookieConsentResponse)
async def update_user_cookie_consent(
    update: UserCookieConsentUpdate,
    settings_service: SettingsServiceDep,
    current_user: User = Depends(get_current_active_user),
):
    """Create or update authenticated user's cookie-consent selection."""
    try:
        consent = await settings_service.upsert_user_cookie_consent(
            current_user.id, update
        )
        return consent
    except Exception as e:
        log_and_raise_http(
            logger,
            e,
            "failed_to_update_user_cookie_consent",
        )
