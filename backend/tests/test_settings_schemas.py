"""Settings boundary validation tests."""

import pytest
from pydantic import ValidationError

from app.features.settings.schemas import (
    CookieConsentLevel,
    SettingUpdate,
    ThemeEnum,
    UserCookieConsentUpdate,
    UserSettingsUpdate,
)


def test_setting_update_rejects_empty_sensitive_value() -> None:
    with pytest.raises(ValidationError):
        SettingUpdate(value="")


def test_user_settings_accepts_bounded_values() -> None:
    update = UserSettingsUpdate(
        theme=ThemeEnum.DARK,
        default_platform="eun1",
    )
    assert update.default_platform == "eun1"
    assert "saved_playstyle_puuid" not in UserSettingsUpdate.model_fields


@pytest.mark.parametrize(("field", "value"), [("default_platform", "eun11")])
def test_user_settings_rejects_oversized_values(field: str, value: str) -> None:
    with pytest.raises(ValidationError):
        UserSettingsUpdate(**{field: value})


def test_cookie_consent_defaults_are_explicit_and_bounded() -> None:
    consent = UserCookieConsentUpdate(consent_level=CookieConsentLevel.NECESSARY)
    assert consent.consent_version == "v1"
    assert consent.consent_source == "banner"

    with pytest.raises(ValidationError):
        UserCookieConsentUpdate(
            consent_level=CookieConsentLevel.ALL,
            consent_source="x" * 33,
        )
