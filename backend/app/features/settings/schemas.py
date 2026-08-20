"""Pydantic schemas for system settings."""

from datetime import datetime
from enum import Enum as PyEnum
from typing import Any, Literal, TypeGuard

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    field_validator,
    model_validator,
)
from pydantic.alias_generators import to_camel


class ThemeEnum(str, PyEnum):
    """Theme preference enum."""

    LIGHT = "LIGHT"
    DARK = "DARK"


class CardId(str, PyEnum):
    """Approved first-release analytical-card identifiers."""

    TOP_CHAMPIONS = "profile.top-champions"
    RECENT_PERFORMANCE = "profile.recent-performance"
    SMURF_BOOST_DETECTION = "profile.smurf-boost-detection"


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
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
    )


class _CardSettingsWriteBase(BaseModel):
    """Strict external request contract that accepts canonical aliases only."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=False,
        extra="forbid",
    )


class TopChampionsMutableSettingsV1(_CardSettingsBase):
    """Mutable Top Champions fields in the approved version 1 contract."""

    minimum_games: int = Field(default=1, ge=1, le=999)
    minimum_win_rate: float = Field(default=0, ge=0, le=100)
    minimum_kda: float = Field(default=0, ge=0, le=50, multiple_of=0.1)
    included_roles: list[CardRole] = Field(default_factory=list[CardRole])

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


def _validate_smurf_boost_cross_fields(
    minimum_novel_games: int, recent_window_size: int
) -> None:
    """Reject a detection set whose novel-champion gate can never be met.

    A minimum above the recent window size would make A3 permanently
    unavailable rather than merely strict, which is a configuration error and
    not a valid preference.
    """
    if minimum_novel_games > recent_window_size:
        raise ValueError("a3MinimumNovelGames must not exceed recentWindowSize")


class SmurfBoostDetectionMutableSettingsV1(_CardSettingsBase):
    """Mutable smurf and boost detection thresholds in the version 1 contract.

    Defaults are the Conservative preset. Every bound sits strictly below the
    matching signal saturation constant, so the magnitude ramp in
    `smurf-boost/v1` can never divide by zero or by a negative number.
    """

    recent_window_size: int = Field(default=20, ge=10, le=50)
    baseline_window_size: int = Field(default=60, ge=15, le=200)
    a1_step_change_threshold: float = Field(default=1.20, ge=0.60, le=2.00)
    a2_win_rate_surge_threshold: float = Field(default=0.20, ge=0.10, le=0.35)
    a3_novel_champion_threshold: float = Field(default=1.20, ge=0.60, le=2.00)
    a3_minimum_novel_games: int = Field(default=8, ge=5, le=15)
    a4_summoner_level_gate: int = Field(default=45, ge=30, le=150)
    a4_performance_threshold: float = Field(default=1.20, ge=0.60, le=2.00)
    b1_win_rate_delta_threshold: float = Field(default=0.30, ge=0.15, le=0.45)
    b1_composite_flat_ceiling: float = Field(default=0.05, ge=0.00, le=0.40)
    b2_consistency_shift_threshold: float = Field(default=1.15, ge=0.60, le=1.50)
    b3_bimodality_threshold: float = Field(default=0.65, ge=0.555, le=0.80)
    b3_tail_fraction: float = Field(default=0.30, ge=0.15, le=0.40)
    b4_high_rate_floor: float = Field(default=0.62, ge=0.50, le=0.80)
    b4_drop_threshold: float = Field(default=0.20, ge=0.10, le=0.45)

    @model_validator(mode="after")
    def cross_field_rules_must_hold(self) -> SmurfBoostDetectionMutableSettingsV1:
        """Reject a set whose signals could never be satisfiable together."""
        _validate_smurf_boost_cross_fields(
            self.a3_minimum_novel_games, self.recent_window_size
        )
        return self


def _require_json_integer(value: object) -> int:
    """Reject coerced values while accepting only JSON integer settings writes."""
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError("must be an integer")
    return value


def _require_json_number(value: object) -> float | int:
    """Reject boolean and string coercion for JSON numeric settings writes."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("must be a number")
    return value


class TopChampionsMutableSettingsWriteV1(_CardSettingsWriteBase):
    """Strict write-only contract that leaves legacy reads tolerant."""

    minimum_games: int = Field(alias="minimumGames", default=1, ge=1, le=999)
    minimum_win_rate: float = Field(alias="minimumWinRate", default=0, ge=0, le=100)
    minimum_kda: float = Field(
        alias="minimumKda", default=0, ge=0, le=50, multiple_of=0.1
    )
    included_roles: list[CardRole] = Field(
        alias="includedRoles", default_factory=list[CardRole]
    )

    @field_validator("minimum_games", mode="before")
    @classmethod
    def minimum_games_must_be_an_integer(cls, value: object) -> int:
        """Reject strings, booleans, and decimal values before coercion."""
        return _require_json_integer(value)

    @field_validator("minimum_win_rate", "minimum_kda", mode="before")
    @classmethod
    def threshold_must_be_a_number(cls, value: object) -> float | int:
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

    recent_match_count: int = Field(alias="recentMatchCount", default=10, ge=5, le=50)
    win_rate_trend_delta: float = Field(
        alias="winRateTrendDelta", default=0.05, ge=0.01, le=0.25
    )
    relative_metric_trend_delta: float = Field(
        alias="relativeMetricTrendDelta", default=0.05, ge=0.01, le=0.25
    )

    @field_validator("recent_match_count", mode="before")
    @classmethod
    def match_count_must_be_an_integer(cls, value: object) -> int:
        """Reject strings, booleans, and decimal values before coercion."""
        return _require_json_integer(value)

    @field_validator(
        "win_rate_trend_delta", "relative_metric_trend_delta", mode="before"
    )
    @classmethod
    def threshold_must_be_a_number(cls, value: object) -> float | int:
        """Reject strings and booleans before normal numeric validation."""
        return _require_json_number(value)


class SmurfBoostDetectionMutableSettingsWriteV1(_CardSettingsWriteBase):
    """Strict write-only smurf and boost detection threshold contract."""

    recent_window_size: int = Field(alias="recentWindowSize", default=20, ge=10, le=50)
    baseline_window_size: int = Field(
        alias="baselineWindowSize", default=60, ge=15, le=200
    )
    a1_step_change_threshold: float = Field(
        alias="a1StepChangeThreshold", default=1.20, ge=0.60, le=2.00
    )
    a2_win_rate_surge_threshold: float = Field(
        alias="a2WinRateSurgeThreshold", default=0.20, ge=0.10, le=0.35
    )
    a3_novel_champion_threshold: float = Field(
        alias="a3NovelChampionThreshold", default=1.20, ge=0.60, le=2.00
    )
    a3_minimum_novel_games: int = Field(
        alias="a3MinimumNovelGames", default=8, ge=5, le=15
    )
    a4_summoner_level_gate: int = Field(
        alias="a4SummonerLevelGate", default=45, ge=30, le=150
    )
    a4_performance_threshold: float = Field(
        alias="a4PerformanceThreshold", default=1.20, ge=0.60, le=2.00
    )
    b1_win_rate_delta_threshold: float = Field(
        alias="b1WinRateDeltaThreshold", default=0.30, ge=0.15, le=0.45
    )
    b1_composite_flat_ceiling: float = Field(
        alias="b1CompositeFlatCeiling", default=0.05, ge=0.00, le=0.40
    )
    b2_consistency_shift_threshold: float = Field(
        alias="b2ConsistencyShiftThreshold", default=1.15, ge=0.60, le=1.50
    )
    b3_bimodality_threshold: float = Field(
        alias="b3BimodalityThreshold", default=0.65, ge=0.555, le=0.80
    )
    b3_tail_fraction: float = Field(
        alias="b3TailFraction", default=0.30, ge=0.15, le=0.40
    )
    b4_high_rate_floor: float = Field(
        alias="b4HighRateFloor", default=0.62, ge=0.50, le=0.80
    )
    b4_drop_threshold: float = Field(
        alias="b4DropThreshold", default=0.20, ge=0.10, le=0.45
    )

    @field_validator(
        "recent_window_size",
        "baseline_window_size",
        "a3_minimum_novel_games",
        "a4_summoner_level_gate",
        mode="before",
    )
    @classmethod
    def window_setting_must_be_an_integer(cls, value: object) -> int:
        """Reject strings, booleans, and decimal values before coercion."""
        return _require_json_integer(value)

    @field_validator(
        "a1_step_change_threshold",
        "a2_win_rate_surge_threshold",
        "a3_novel_champion_threshold",
        "a4_performance_threshold",
        "b1_win_rate_delta_threshold",
        "b1_composite_flat_ceiling",
        "b2_consistency_shift_threshold",
        "b3_bimodality_threshold",
        "b3_tail_fraction",
        "b4_high_rate_floor",
        "b4_drop_threshold",
        mode="before",
    )
    @classmethod
    def detection_threshold_must_be_a_number(cls, value: object) -> float | int:
        """Reject strings and booleans before normal numeric validation."""
        return _require_json_number(value)

    @model_validator(mode="after")
    def cross_field_rules_must_hold(
        self,
    ) -> SmurfBoostDetectionMutableSettingsWriteV1:
        """Reject a set whose signals could never be satisfiable together."""
        _validate_smurf_boost_cross_fields(
            self.a3_minimum_novel_games, self.recent_window_size
        )
        return self


class CardPreferenceUpdate(_CardSettingsWriteBase):
    """Versioned request body for a complete card-specific preference update."""

    version: Literal[1]
    settings: dict[str, Any]

    @field_validator("version", mode="before")
    @classmethod
    def version_must_be_an_integer(cls, value: object) -> int:
        """Reject coercion before the supported-version literal is checked."""
        return _require_json_integer(value)


class CardPreferenceResponse(_CardSettingsBase):
    """Normalized effective settings for one approved card."""

    card_id: CardId
    version: Literal[1] = 1
    settings: dict[str, Any]
    is_default: bool
    requires_recovery: bool = False
    updated_at: datetime | None = None


class CardPreferencesResetRequest(_CardSettingsWriteBase):
    """Explicit catalog confirmation required before resetting every card."""

    card_ids: list[CardId] = Field(alias="cardIds", min_length=3, max_length=3)

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
    CardId.SMURF_BOOST_DETECTION: SmurfBoostDetectionMutableSettingsV1,
}

_CARD_SETTINGS_WRITE_MODELS: dict[CardId, type[_CardSettingsWriteBase]] = {
    CardId.TOP_CHAMPIONS: TopChampionsMutableSettingsWriteV1,
    CardId.RECENT_PERFORMANCE: RecentPerformanceMutableSettingsWriteV1,
    CardId.SMURF_BOOST_DETECTION: SmurfBoostDetectionMutableSettingsWriteV1,
}

_CARD_FIXED_SETTINGS_V1: dict[CardId, dict[str, int]] = {
    CardId.TOP_CHAMPIONS: {"queue_id": 420, "display_limit": 5},
    CardId.RECENT_PERFORMANCE: {"queue_id": 420},
    CardId.SMURF_BOOST_DETECTION: {"queue_id": 420},
}

# This map is intentionally explicit even while v1 has no renamed fields. A
# future contract revision must add a reviewed mapping before it changes a
# persisted name, so legacy values are never silently repurposed.
_LEGACY_SETTING_RENAMES: dict[CardId, dict[str, str]] = {
    CardId.TOP_CHAMPIONS: {},
    CardId.RECENT_PERFORMANCE: {},
    CardId.SMURF_BOOST_DETECTION: {},
}

_LEGACY_INTEGER_SETTING_FIELDS = frozenset(
    {
        "minimum_games",
        "recent_match_count",
        "recent_window_size",
        "baseline_window_size",
        "a3_minimum_novel_games",
        "a4_summoner_level_gate",
    }
)
_LEGACY_NUMBER_SETTING_FIELDS = frozenset(
    {
        "minimum_win_rate",
        "minimum_kda",
        "win_rate_trend_delta",
        "relative_metric_trend_delta",
        "a1_step_change_threshold",
        "a2_win_rate_surge_threshold",
        "a3_novel_champion_threshold",
        "a4_performance_threshold",
        "b1_win_rate_delta_threshold",
        "b1_composite_flat_ceiling",
        "b2_consistency_shift_threshold",
        "b3_bimodality_threshold",
        "b3_tail_fraction",
        "b4_high_rate_floor",
        "b4_drop_threshold",
    }
)


def _is_compatible_legacy_setting_value(field_name: str, value: object) -> bool:
    """Accept only documented legacy numeric forms before Pydantic coercion.

    Historic integer strings remain supported, but booleans and floats must not
    silently become integer card settings on a legacy read.
    """
    if field_name in _LEGACY_INTEGER_SETTING_FIELDS:
        return (isinstance(value, int) and not isinstance(value, bool)) or (
            isinstance(value, str) and value.isascii() and value.isdecimal()
        )
    if field_name in _LEGACY_NUMBER_SETTING_FIELDS:
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    return True


def _is_json_object(value: object) -> TypeGuard[dict[str, Any]]:
    """Narrow a decoded JSONB column to the object shape its writers produce.

    A JSONB object always decodes with string keys; its values are whatever an
    older contract wrote, and each one is screened before it reaches a model.
    """
    return isinstance(value, dict)


def validate_card_preference_update(
    card_id: CardId, settings: dict[str, Any]
) -> dict[str, Any]:
    """Validate one complete mutable v1 payload before an atomic upsert."""
    model_type = _CARD_SETTINGS_WRITE_MODELS[card_id]
    parsed = model_type.model_validate(settings)
    missing_fields = set(model_type.model_fields) - parsed.model_fields_set
    if missing_fields:
        missing = ", ".join(sorted(to_camel(field) for field in missing_fields))
        raise ValueError(f"Missing required settings for {card_id.value}: {missing}")
    return parsed.model_dump(mode="json")


def normalize_stored_card_preference(
    card_id: CardId, stored_settings: object
) -> tuple[dict[str, Any], tuple[str, ...]]:
    """Merge a legacy record with defaults without applying invalid fields."""
    model_type = _CARD_SETTINGS_MODELS[card_id]
    normalized = model_type().model_dump(mode="json")
    warnings: list[str] = []
    if not _is_json_object(stored_settings):
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
    return {to_camel(name): value for name, value in settings.items()}


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
    status: Literal["valid", "invalid", "unavailable"]
    message: str = Field(..., description="Validation message")
    details: str | None = Field(
        default=None, description="Additional validation details"
    )


class SettingTestResponse(BaseModel):
    """Schema for setting test response."""

    success: bool = Field(..., description="Whether the test was successful")
    status: Literal["valid", "invalid", "unavailable"]
    message: str = Field(..., description="Test result message")
    details: dict[str, Any] | None = Field(
        default=None, description="Additional test details"
    )


class APIKeyStatusResponse(BaseModel):
    """Admin configuration detail backed by the shared credential-health state."""

    has_db_key: bool
    has_env_key: bool
    active_source: Literal["db", "env", "none"]
    credential_status: Literal["missing", "unknown", "valid", "invalid"]
    evidence: Literal[
        "missing",
        "configured",
        "settings_validation",
        "provider_success",
        "credential_rejected",
    ]
    observed_at: datetime
    health_revision: int = Field(..., gt=0)


class ServiceStatusResponse(BaseModel):
    """Shared admin/non-admin view of authoritative credential health."""

    is_under_maintenance: bool
    reason: Literal["ok", "api_key_missing", "api_key_invalid"]
    active_source: Literal["db", "env", "none"]
    credential_status: Literal["missing", "unknown", "valid", "invalid"]
    health_revision: int = Field(..., gt=0)
    observed_at: datetime
    has_recent_recovery: bool = Field(
        ..., description="Whether the current generation recovered from key failure"
    )
    recovery_notice_key: str | None = Field(
        default=None,
        description=(
            "Unique key for the latest recovery event, used by frontend for dismiss persistence"
        ),
    )


# ===== USER SETTINGS SCHEMAS =====


class UserSettingsResponse(BaseModel):
    """Deprecated compatibility response for retired application settings."""

    theme: ThemeEnum = Field(
        default=ThemeEnum.DARK,
        description="Deprecated fixed compatibility value; not persisted",
    )
    default_platform: str | None = Field(
        default="eun1",
        description="Deprecated fixed compatibility value; not persisted",
    )
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UserSettingsUpdate(BaseModel):
    """Deprecated compatibility input; accepted values no longer affect behavior."""

    theme: ThemeEnum | None = Field(default=None, description="Theme preference")
    default_platform: str | None = Field(
        default=None, max_length=4, description="Default server/platform"
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
