"""Pydantic schemas for system settings."""

from datetime import datetime
from enum import Enum as PyEnum
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator


class ThemeEnum(str, PyEnum):
    """Theme preference enum."""

    LIGHT = "LIGHT"
    DARK = "DARK"


def _to_camel_case(value: str) -> str:
    """Convert an internal snake_case field name into an API field name."""
    head, *tail = value.split("_")
    return head + "".join(part.capitalize() for part in tail)


class CardId(str, PyEnum):
    """Approved first-release analytical-card identifiers."""

    TOP_CHAMPIONS = "profile.top-champions"
    RECENT_PERFORMANCE = "profile.recent-performance"


class CardRole(str, PyEnum):
    """Canonical Riot team-position values allowed by the card contract."""

    TOP = "TOP"
    JUNGLE = "JUNGLE"
    MIDDLE = "MIDDLE"
    BOTTOM = "BOTTOM"
    UTILITY = "UTILITY"


class _CardSettingsBase(BaseModel):
    """Shared API compatibility settings for the versioned card contract."""

    model_config = ConfigDict(
        alias_generator=_to_camel_case,
        populate_by_name=True,
        extra="forbid",
    )


class _CardSettingsWriteBase(BaseModel):
    """Strict external request contract that accepts canonical aliases only."""

    model_config = ConfigDict(
        alias_generator=_to_camel_case,
        populate_by_name=False,
        extra="forbid",
    )


class TopChampionsMutableSettingsV1(_CardSettingsBase):
    """Mutable Top Champions fields in the approved version 1 contract."""

    minimum_games: int = Field(default=1, ge=1, le=999)
    minimum_win_rate: float = Field(default=0, ge=0, le=100)
    minimum_kda: float = Field(default=0, ge=0, le=50, multiple_of=0.1)
    included_roles: list[CardRole] = Field(default_factory=list)

    @field_validator("included_roles")
    @classmethod
    def roles_must_be_unique(cls, roles: list[CardRole]) -> list[CardRole]:
        """Reject duplicate roles instead of normalizing a malformed write."""
        if len(roles) != len(set(roles)):
            raise ValueError("includedRoles must contain unique canonical roles")
        return roles


class RecentPerformanceMutableSettingsV1(_CardSettingsBase):
    """Mutable Recent Performance fields in the approved version 1 contract."""

    recent_match_count: int = Field(default=10, ge=5, le=50)
    win_rate_trend_delta: float = Field(default=0.05, ge=0.01, le=0.25)
    relative_metric_trend_delta: float = Field(default=0.05, ge=0.01, le=0.25)


def _require_json_integer(value: Any) -> int:
    """Reject coerced values while accepting only JSON integer settings writes."""
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError("must be an integer")
    return value


def _require_json_number(value: Any) -> float | int:
    """Reject boolean and string coercion for JSON numeric settings writes."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("must be a number")
    return value


class TopChampionsMutableSettingsWriteV1(_CardSettingsWriteBase):
    """Strict write-only contract that leaves legacy reads tolerant."""

    minimum_games: int = Field(default=1, ge=1, le=999)
    minimum_win_rate: float = Field(default=0, ge=0, le=100)
    minimum_kda: float = Field(default=0, ge=0, le=50, multiple_of=0.1)
    included_roles: list[CardRole] = Field(default_factory=list)

    @field_validator("minimum_games", mode="before")
    @classmethod
    def minimum_games_must_be_an_integer(cls, value: Any) -> int:
        """Reject strings, booleans, and decimal values before coercion."""
        return _require_json_integer(value)

    @field_validator("minimum_win_rate", "minimum_kda", mode="before")
    @classmethod
    def threshold_must_be_a_number(cls, value: Any) -> float | int:
        """Reject strings and booleans before normal numeric validation."""
        return _require_json_number(value)

    @field_validator("included_roles")
    @classmethod
    def roles_must_be_unique(cls, roles: list[CardRole]) -> list[CardRole]:
        """Reject duplicate roles instead of normalizing a malformed write."""
        if len(roles) != len(set(roles)):
            raise ValueError("includedRoles must contain unique canonical roles")
        return roles


class RecentPerformanceMutableSettingsWriteV1(_CardSettingsWriteBase):
    """Strict write-only contract that leaves legacy reads tolerant."""

    recent_match_count: int = Field(default=10, ge=5, le=50)
    win_rate_trend_delta: float = Field(default=0.05, ge=0.01, le=0.25)
    relative_metric_trend_delta: float = Field(default=0.05, ge=0.01, le=0.25)

    @field_validator("recent_match_count", mode="before")
    @classmethod
    def match_count_must_be_an_integer(cls, value: Any) -> int:
        """Reject strings, booleans, and decimal values before coercion."""
        return _require_json_integer(value)

    @field_validator(
        "win_rate_trend_delta", "relative_metric_trend_delta", mode="before"
    )
    @classmethod
    def threshold_must_be_a_number(cls, value: Any) -> float | int:
        """Reject strings and booleans before normal numeric validation."""
        return _require_json_number(value)


class CardPreferenceUpdate(_CardSettingsWriteBase):
    """Versioned request body for a complete card-specific preference update."""

    version: Literal[1]
    settings: dict[str, Any]

    @field_validator("version", mode="before")
    @classmethod
    def version_must_be_an_integer(cls, value: Any) -> int:
        """Reject coercion before the supported-version literal is checked."""
        return _require_json_integer(value)


class CardPreferenceResponse(_CardSettingsBase):
    """Normalized effective settings for one approved card."""

    card_id: CardId
    version: Literal[1] = 1
    settings: dict[str, Any]
    is_default: bool
    requires_recovery: bool = False
    updated_at: Optional[datetime] = None


class CardPreferencesResetRequest(_CardSettingsWriteBase):
    """Explicit catalog confirmation required before resetting every card."""

    card_ids: list[CardId] = Field(min_length=2, max_length=2)

    @field_validator("card_ids")
    @classmethod
    def must_confirm_the_full_current_catalog(
        cls, card_ids: list[CardId]
    ) -> list[CardId]:
        """Avoid an ambiguous global reset that silently omits a catalog entry."""
        if set(card_ids) != set(CardId) or len(card_ids) != len(set(card_ids)):
            raise ValueError("cardIds must enumerate each current card exactly once")
        return card_ids


_CARD_SETTINGS_MODELS: dict[CardId, type[_CardSettingsBase]] = {
    CardId.TOP_CHAMPIONS: TopChampionsMutableSettingsV1,
    CardId.RECENT_PERFORMANCE: RecentPerformanceMutableSettingsV1,
}

_CARD_SETTINGS_WRITE_MODELS: dict[CardId, type[_CardSettingsWriteBase]] = {
    CardId.TOP_CHAMPIONS: TopChampionsMutableSettingsWriteV1,
    CardId.RECENT_PERFORMANCE: RecentPerformanceMutableSettingsWriteV1,
}

_CARD_FIXED_SETTINGS_V1: dict[CardId, dict[str, int]] = {
    CardId.TOP_CHAMPIONS: {"queue_id": 420, "display_limit": 5},
    CardId.RECENT_PERFORMANCE: {"queue_id": 420},
}

# This map is intentionally explicit even while v1 has no renamed fields. A
# future contract revision must add a reviewed mapping before it changes a
# persisted name, so legacy values are never silently repurposed.
_LEGACY_SETTING_RENAMES: dict[CardId, dict[str, str]] = {
    CardId.TOP_CHAMPIONS: {},
    CardId.RECENT_PERFORMANCE: {},
}

_LEGACY_INTEGER_SETTING_FIELDS = frozenset({"minimum_games", "recent_match_count"})
_LEGACY_NUMBER_SETTING_FIELDS = frozenset(
    {
        "minimum_win_rate",
        "minimum_kda",
        "win_rate_trend_delta",
        "relative_metric_trend_delta",
    }
)


def _is_compatible_legacy_setting_value(field_name: str, value: object) -> bool:
    """Accept only documented legacy numeric forms before Pydantic coercion.

    Historic integer strings remain supported, but booleans and floats must not
    silently become integer card settings on a legacy read.
    """
    if field_name in _LEGACY_INTEGER_SETTING_FIELDS:
        return (
            isinstance(value, int)
            and not isinstance(value, bool)
            or isinstance(value, str)
            and value.isascii()
            and value.isdecimal()
        )
    if field_name in _LEGACY_NUMBER_SETTING_FIELDS:
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    return True


def validate_card_preference_update(
    card_id: CardId, settings: dict[str, Any]
) -> dict[str, Any]:
    """Validate one complete mutable v1 payload before an atomic upsert."""
    model_type = _CARD_SETTINGS_WRITE_MODELS[card_id]
    parsed = model_type.model_validate(settings)
    missing_fields = set(model_type.model_fields) - parsed.model_fields_set
    if missing_fields:
        missing = ", ".join(sorted(_to_camel_case(field) for field in missing_fields))
        raise ValueError(f"Missing required settings for {card_id.value}: {missing}")
    return parsed.model_dump(mode="json")


def normalize_stored_card_preference(
    card_id: CardId, stored_settings: object
) -> tuple[dict[str, Any], tuple[str, ...]]:
    """Merge a legacy record with defaults without applying invalid fields."""
    model_type = _CARD_SETTINGS_MODELS[card_id]
    normalized = model_type().model_dump(mode="json")
    warnings: list[str] = []
    if not isinstance(stored_settings, dict):
        return {**_CARD_FIXED_SETTINGS_V1[card_id], **normalized}, ("settings",)

    renames = _LEGACY_SETTING_RENAMES[card_id]
    for raw_name, value in stored_settings.items():
        field_name = renames.get(raw_name, raw_name)
        if field_name not in model_type.model_fields:
            warnings.append(str(raw_name))
            continue
        if not _is_compatible_legacy_setting_value(field_name, value):
            warnings.append(str(raw_name))
            continue
        candidate = {**normalized, field_name: value}
        try:
            normalized = model_type.model_validate(candidate).model_dump(mode="json")
        except ValidationError:
            warnings.append(str(raw_name))

    return {**_CARD_FIXED_SETTINGS_V1[card_id], **normalized}, tuple(warnings)


def serialize_card_preference_settings(settings: dict[str, Any]) -> dict[str, Any]:
    """Serialize normalized internal fields using the approved API field names."""
    return {_to_camel_case(name): value for name, value in settings.items()}


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
        default="banner",
        min_length=1,
        max_length=32,
        description="Consent capture source",
    )
