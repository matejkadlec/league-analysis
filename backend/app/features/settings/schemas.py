"""Pydantic schemas for system settings."""

from datetime import datetime
from typing import Optional
from enum import Enum as PyEnum

from pydantic import BaseModel, Field, ConfigDict


class ThemeEnum(str, PyEnum):
    """Theme preference enum."""

    LIGHT = "LIGHT"
    DARK = "DARK"


class SettingUpdate(BaseModel):
    """Schema for updating a setting value."""

    value: str = Field(..., min_length=1, description="New setting value")


class SettingResponse(BaseModel):
    """Schema for setting response.

    Note: For security, only masked_value is populated for sensitive settings.
    The full value is never sent to the frontend.
    """

    key: str
    masked_value: str = Field(..., description="Masked value for sensitive settings")
    category: str
    is_sensitive: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SettingValidationResponse(BaseModel):
    """Schema for setting validation response."""

    valid: bool = Field(..., description="Whether the value is valid")
    message: str = Field(..., description="Validation message")
    details: Optional[str] = Field(None, description="Additional validation details")


class SettingTestResponse(BaseModel):
    """Schema for setting test response."""

    success: bool = Field(..., description="Whether the test was successful")
    message: str = Field(..., description="Test result message")
    details: Optional[dict] = Field(None, description="Additional test details")


class APIKeyStatusResponse(BaseModel):
    """Response schema for API key status."""

    has_db_key: bool
    has_env_key: bool
    active_source: str  # "db", "env", "none"
    env_key_identifier: Optional[str] = Field(
        None,
        description="Short identifier (hash/slice) of the env key to track uniqueness",
    )


class ServiceStatusResponse(BaseModel):
    """Response schema for user-facing service maintenance status."""

    is_under_maintenance: bool
    reason: str = Field(
        ..., description="Maintenance reason identifier, e.g. 'ok', 'api_key_issue'"
    )
    no_active_key_configured: bool
    latest_job_has_api_key_failure: bool
    has_recent_recovery: bool = Field(
        ..., description="Whether a previously failing API-key state is now resolved"
    )
    recovery_notice_key: Optional[str] = Field(
        None,
        description=(
            "Unique key for the latest recovery event, used by frontend for dismiss persistence"
        ),
    )


# ===== USER SETTINGS SCHEMAS =====


class UserSettingsResponse(BaseModel):
    """Schema for user settings response."""

    theme: ThemeEnum = Field(..., description="User's theme preference")
    save_playstyle_url: bool = Field(
        ..., description="Whether to save playstyle analysis PUUID in URL"
    )
    saved_playstyle_puuid: Optional[str] = Field(
        None, description="Saved PUUID for playstyle analysis"
    )
    save_matchmaking_url: bool = Field(
        ..., description="Whether to save matchmaking analysis PUUID in URL"
    )
    saved_matchmaking_puuid: Optional[str] = Field(
        None, description="Saved PUUID for matchmaking analysis"
    )
    save_tracked_url: bool = Field(
        ..., description="Whether to save tracked players viewed PUUID in URL"
    )
    saved_tracked_puuid: Optional[str] = Field(
        None, description="Saved PUUID for tracked players page"
    )
    default_platform: Optional[str] = Field(
        "eun1", description="Default server/platform"
    )
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UserSettingsUpdate(BaseModel):
    """Schema for updating user settings."""

    theme: Optional[ThemeEnum] = Field(None, description="Theme preference")
    save_playstyle_url: Optional[bool] = Field(
        None, description="Save playstyle PUUID in URL"
    )
    saved_playstyle_puuid: Optional[str] = Field(
        None, max_length=78, description="Saved playstyle PUUID"
    )
    save_matchmaking_url: Optional[bool] = Field(
        None, description="Save matchmaking PUUID in URL"
    )
    saved_matchmaking_puuid: Optional[str] = Field(
        None, max_length=78, description="Saved matchmaking PUUID"
    )
    save_tracked_url: Optional[bool] = Field(
        None, description="Save tracked players viewed PUUID in URL"
    )
    saved_tracked_puuid: Optional[str] = Field(
        None, max_length=78, description="Saved tracked players PUUID"
    )
    default_platform: Optional[str] = Field(
        None, max_length=4, description="Default server/platform"
    )


class CookieConsentLevel(str, PyEnum):
    """Cookie-consent levels exposed in settings API."""

    NECESSARY = "necessary"
    ALL = "all"


class UserCookieConsentResponse(BaseModel):
    """Schema for authenticated user cookie-consent state."""

    consent_level: CookieConsentLevel = Field(
        ..., description="Selected consent level for non-essential storage"
    )
    consent_version: str = Field(
        ..., min_length=1, max_length=16, description="Consent policy version"
    )
    consent_source: str = Field(
        ..., min_length=1, max_length=32, description="Consent capture source"
    )
    consented_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UserCookieConsentUpdate(BaseModel):
    """Schema for updating authenticated user cookie consent."""

    consent_level: CookieConsentLevel = Field(
        ..., description="Selected consent level for non-essential storage"
    )
    consent_version: str = Field(
        default="v1", min_length=1, max_length=16, description="Consent policy version"
    )
    consent_source: str = Field(
        default="banner", min_length=1, max_length=32, description="Consent capture source"
    )
