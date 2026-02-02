"""Settings API endpoints for managing system configuration."""

from fastapi import APIRouter, HTTPException, Depends
import structlog

from .schemas import (
    SettingResponse,
    SettingUpdate,
    SettingTestResponse,
    APIKeyStatusResponse,
    UserSettingsResponse,
    UserSettingsUpdate,
)
from .dependencies import SettingsServiceDep
from app.features.auth.dependencies import get_current_active_user
from app.features.auth.models import User

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("/riot_api_key/status", response_model=APIKeyStatusResponse)
async def get_riot_api_key_status(
    settings_service: SettingsServiceDep,
):
    """
    Get the status of the Riot API key configuration.
    Returns whether valid key exists in DB or Env, and which one is active.
    Used for UI header messages.
    """
    return await settings_service.get_api_key_status()


@router.get("/riot_api_key", response_model=SettingResponse)
async def get_riot_api_key(
    settings_service: SettingsServiceDep,
):
    """Get current Riot API key (value is masked for security)."""
    try:
        setting = await settings_service.get_setting("riot_api_key")

        if not setting:
            raise HTTPException(
                status_code=404,
                detail="Riot API key setting not found. Using environment variable.",
            )

        return setting

    except HTTPException:
        raise
    except Exception as e:
        logger.error("failed_to_get_riot_api_key", error=str(e), exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Internal server error retrieving Riot API key",
        )


@router.put("/riot_api_key", response_model=SettingResponse)
async def update_riot_api_key(
    update: SettingUpdate,
    settings_service: SettingsServiceDep,
):
    """
    Update the Riot API key.

    The new key is validated against the Riot API before being saved.
    If validation fails, the update is rejected.

    **Note**: After updating, you should restart the backend application
    for the changes to take effect properly.
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
                category="riot_api",
                is_sensitive=True,
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
        raise HTTPException(status_code=400, detail=str(e))

    except Exception as e:
        logger.error("failed_to_update_riot_api_key", error=str(e), exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Internal server error updating Riot API key",
        )


@router.post("/riot_api_key/test", response_model=SettingTestResponse)
async def test_riot_api_key(
    update: SettingUpdate,
    settings_service: SettingsServiceDep,
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
        logger.error("failed_to_test_riot_api_key", error=str(e), exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Internal server error testing Riot API key",
        )


# ===== USER SETTINGS ENDPOINTS =====


@router.get("/user", response_model=UserSettingsResponse)
async def get_user_settings(
    current_user: User = Depends(get_current_active_user),
    settings_service: SettingsServiceDep = None,
):
    """
    Get the current user's settings.

    Returns the user's preferences including theme, URL persistence settings,
    and saved PUUIDs. Creates default settings if none exist.
    """
    try:
        settings = await settings_service.get_or_create_user_settings(current_user.id)
        return settings
    except Exception as e:
        logger.error("failed_to_get_user_settings", error=str(e), exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Failed to get user settings",
        )


@router.put("/user", response_model=UserSettingsResponse)
async def update_user_settings(
    update: UserSettingsUpdate,
    current_user: User = Depends(get_current_active_user),
    settings_service: SettingsServiceDep = None,
):
    """
    Update the current user's settings.

    Only provided fields will be updated. To clear a saved PUUID,
    set the corresponding field to null/empty string.
    """
    try:
        settings = await settings_service.update_user_settings(current_user.id, update)
        return settings
    except Exception as e:
        logger.error("failed_to_update_user_settings", error=str(e), exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Failed to update user settings",
        )
