"""Settings boundary validation tests."""

import inspect

import pytest
from pydantic import BaseModel, ConfigDict, ValidationError
from pydantic.alias_generators import to_camel

from app.features.settings import schemas
from app.features.settings.schemas import (
    CookieConsentLevel,
    SettingUpdate,
    UserCookieConsentUpdate,
)


def test_setting_update_rejects_empty_sensitive_value() -> None:
    with pytest.raises(ValidationError):
        SettingUpdate(value="")


def test_cookie_consent_defaults_are_explicit_and_bounded() -> None:
    consent = UserCookieConsentUpdate(consent_level=CookieConsentLevel.NECESSARY)
    assert consent.consent_version == "v1"
    assert consent.consent_source == "banner"

    with pytest.raises(ValidationError):
        UserCookieConsentUpdate(
            consent_level=CookieConsentLevel.ALL,
            consent_source="x" * 33,
        )


def _write_contract_models() -> list[type[BaseModel]]:
    """Every strict write model, found by configuration rather than by name."""
    return [
        obj
        for obj in vars(schemas).values()
        if inspect.isclass(obj)
        and issubclass(obj, BaseModel)
        and obj.model_config.get("alias_generator") is not None
        and obj.model_config.get("populate_by_name") is False
    ]


def test_strict_write_models_spell_every_alias_explicitly() -> None:
    """A generated alias is invisible to the type checker, so require a literal.

    With `populate_by_name=False` the alias is the *only* accepted spelling at
    runtime, but Pyright builds `__init__` from the field names instead, so it
    rejects the spelling that works. An explicit `Field(alias=...)` suits both.
    """
    models = _write_contract_models()
    assert models, "expected at least one strict write model to guard"

    # Validate this test's own signal first. `info.alias` is populated by the
    # generator too, so checking it for None guards nothing at all; only
    # `alias_priority` separates a generated alias (1) from an explicit one (2).
    class _Probe(BaseModel):
        model_config = ConfigDict(alias_generator=to_camel, populate_by_name=False)

        generated_field: int = 1

    probe = _Probe.model_fields["generated_field"]
    assert probe.alias == "generatedField", "the generator no longer sets an alias"
    assert probe.alias_priority == 1, (
        "alias_priority no longer distinguishes a generated alias from an "
        "explicit one, so the assertion below would pass vacuously"
    )

    missing: list[str] = []
    for model in models:
        for name, info in model.model_fields.items():
            # A field whose camelCase form equals its own name is unambiguous.
            if info.alias_priority != 2 and to_camel(name) != name:
                missing.append(f"{model.__name__}.{name}")

    assert not missing, (
        "these strict write fields rely on the generated alias, so Pyright will "
        f"reject the only spelling that works: {missing}"
    )


def test_strict_write_models_accept_the_alias_and_reject_the_field_name() -> None:
    """Pin the runtime half of the contract the test above type-checks."""
    assert schemas.TopChampionsMutableSettingsWriteV1.model_validate(
        {"minimumGames": 12, "minimumWinRate": 54.5, "minimumKda": 2.3}
    )

    with pytest.raises(ValidationError):
        schemas.TopChampionsMutableSettingsWriteV1.model_validate(
            {"minimum_games": 12, "minimumWinRate": 54.5, "minimumKda": 2.3}
        )
