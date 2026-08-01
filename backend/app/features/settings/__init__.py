"""Settings feature module.

This module provides system settings management functionality,
including runtime configuration and Riot API key management.
"""

from .dependencies import SettingsServiceDep, get_settings_service
from .router import router as settings_router
from .schemas import (
    ServiceStatusResponse,
    SettingResponse,
    SettingTestResponse,
    SettingUpdate,
    SettingValidationResponse,
    UserCookieConsentResponse,
    UserCookieConsentUpdate,
)
from .service import SettingsService

__all__ = [
    # Router
    "settings_router",
    # Service
    "SettingsService",
    # Schemas
    "SettingResponse",
    "SettingUpdate",
    "SettingTestResponse",
    "SettingValidationResponse",
    "ServiceStatusResponse",
    "UserCookieConsentResponse",
    "UserCookieConsentUpdate",
    # Dependencies
    "get_settings_service",
    "SettingsServiceDep",
]
