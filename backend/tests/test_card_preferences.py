"""Regression coverage for the versioned viewer card-preference boundary."""

from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any, cast

import pytest
from pydantic import ValidationError
from sqlalchemy import ClauseElement, Table
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.auth.models import User
from app.features.settings import router
from app.features.settings import service as settings_service_module
from app.features.settings.models import UserCardPreference
from app.features.settings.schemas import (
    CardId,
    CardPreferenceUpdate,
    normalize_stored_card_preference,
    validate_card_preference_update,
)
from app.features.settings.service import SettingsService

TOP_CHAMPIONS_PAYLOAD = {
    "minimumGames": 12,
    "minimumWinRate": 54.5,
    "minimumKda": 2.3,
    "includedRoles": ["TOP", "JUNGLE"],
}

RECENT_PERFORMANCE_PAYLOAD = {
    "recentMatchCount": 15,
    "winRateTrendDelta": 0.07,
    "relativeMetricTrendDelta": 0.11,
}


def test_card_preference_validation_accepts_exact_v1_contracts() -> None:
    """The API converts the camel-case contract into canonical stored fields."""
    assert validate_card_preference_update(
        CardId.TOP_CHAMPIONS, TOP_CHAMPIONS_PAYLOAD
    ) == {
        "minimum_games": 12,
        "minimum_win_rate": 54.5,
        "minimum_kda": 2.3,
        "included_roles": ["TOP", "JUNGLE"],
    }
    assert validate_card_preference_update(
        CardId.RECENT_PERFORMANCE, RECENT_PERFORMANCE_PAYLOAD
    ) == {
        "recent_match_count": 15,
        "win_rate_trend_delta": 0.07,
        "relative_metric_trend_delta": 0.11,
    }


@pytest.mark.parametrize(
    ("card_id", "settings"),
    [
        (CardId.TOP_CHAMPIONS, {**TOP_CHAMPIONS_PAYLOAD, "unknown": True}),
        (CardId.TOP_CHAMPIONS, {**TOP_CHAMPIONS_PAYLOAD, "minimumGames": 0}),
        (
            CardId.TOP_CHAMPIONS,
            {**TOP_CHAMPIONS_PAYLOAD, "includedRoles": ["TOP", "TOP"]},
        ),
        (
            CardId.RECENT_PERFORMANCE,
            {**RECENT_PERFORMANCE_PAYLOAD, "recentMatchCount": 51},
        ),
    ],
)
def test_card_preference_validation_rejects_unknown_or_invalid_values(
    card_id: CardId, settings: dict[str, Any]
) -> None:
    """Unknown settings, unsafe values, and duplicate roles never reach storage."""
    with pytest.raises(ValidationError):
        validate_card_preference_update(card_id, settings)


@pytest.mark.parametrize(
    ("card_id", "settings"),
    [
        (CardId.TOP_CHAMPIONS, {**TOP_CHAMPIONS_PAYLOAD, "minimumGames": "12"}),
        (CardId.TOP_CHAMPIONS, {**TOP_CHAMPIONS_PAYLOAD, "minimumGames": True}),
        (
            CardId.RECENT_PERFORMANCE,
            {**RECENT_PERFORMANCE_PAYLOAD, "recentMatchCount": "15"},
        ),
        (
            CardId.RECENT_PERFORMANCE,
            {**RECENT_PERFORMANCE_PAYLOAD, "winRateTrendDelta": True},
        ),
    ],
)
def test_card_preference_validation_rejects_coerced_numeric_types(
    card_id: CardId, settings: dict[str, Any]
) -> None:
    """Writes reject string and boolean numeric values rather than coercing them."""
    with pytest.raises(ValidationError):
        validate_card_preference_update(card_id, settings)


def test_card_preference_validation_rejects_noncanonical_setting_names() -> None:
    """Writes accept only the documented camel-case settings contract."""
    with pytest.raises(ValidationError):
        validate_card_preference_update(
            CardId.TOP_CHAMPIONS,
            {
                "minimum_games": 12,
                "minimumWinRate": 54.5,
                "minimumKda": 2.3,
                "includedRoles": ["TOP", "JUNGLE"],
            },
        )


@pytest.mark.parametrize("version", [True, 1.0, "1"])
def test_card_preference_update_rejects_coerced_versions(version: Any) -> None:
    """Only the JSON integer literal version 1 can reach the v1 update path."""
    with pytest.raises(ValidationError):
        CardPreferenceUpdate.model_validate(
            {"version": version, "settings": TOP_CHAMPIONS_PAYLOAD}
        )


def test_card_preference_validation_requires_complete_mutable_settings() -> None:
    """A partial write cannot accidentally reset a missing field to its default."""
    with pytest.raises(ValueError, match="includedRoles"):
        validate_card_preference_update(
            CardId.TOP_CHAMPIONS,
            {
                "minimumGames": 1,
                "minimumWinRate": 0,
                "minimumKda": 0,
            },
        )


def test_card_preference_defaults_and_legacy_normalization_are_safe() -> None:
    """Missing, unknown, and malformed legacy fields preserve default behavior."""
    defaults, warnings = normalize_stored_card_preference(CardId.TOP_CHAMPIONS, {})
    assert warnings == ()
    assert defaults == {
        "queue_id": 420,
        "display_limit": 5,
        "minimum_games": 1,
        "minimum_win_rate": 0.0,
        "minimum_kda": 0.0,
        "included_roles": [],
    }

    normalized, warnings = normalize_stored_card_preference(
        CardId.TOP_CHAMPIONS,
        {
            "minimum_games": 25,
            "minimum_win_rate": 101,
            "removed_setting": "ignored",
        },
    )
    assert normalized["minimum_games"] == 25
    assert normalized["minimum_win_rate"] == 0.0
    assert normalized["queue_id"] == 420
    assert set(warnings) == {"minimum_win_rate", "removed_setting"}

    legacy_normalized, legacy_warnings = normalize_stored_card_preference(
        CardId.TOP_CHAMPIONS,
        {"minimum_games": "25"},
    )
    assert legacy_normalized["minimum_games"] == 25
    assert legacy_warnings == ()


@pytest.mark.parametrize(
    ("card_id", "stored_settings", "field_name"),
    [
        (
            CardId.TOP_CHAMPIONS,
            {"minimum_games": True},
            "minimum_games",
        ),
        (
            CardId.TOP_CHAMPIONS,
            {"minimum_games": 25.0},
            "minimum_games",
        ),
        (
            CardId.RECENT_PERFORMANCE,
            {"recent_match_count": 10.0},
            "recent_match_count",
        ),
        (
            CardId.RECENT_PERFORMANCE,
            {"win_rate_trend_delta": True},
            "win_rate_trend_delta",
        ),
    ],
)
def test_card_preference_legacy_normalization_rejects_incompatible_numeric_types(
    card_id: CardId,
    stored_settings: dict[str, Any],
    field_name: str,
) -> None:
    """Legacy numeric coercion produces recovery defaults instead of bad settings."""
    defaults, _ = normalize_stored_card_preference(card_id, {})
    normalized, warnings = normalize_stored_card_preference(card_id, stored_settings)

    assert normalized[field_name] == defaults[field_name]
    assert warnings == (field_name,)


def test_card_preference_model_declares_the_migration_index() -> None:
    """Autogeneration metadata retains the reviewed user/update ordering index."""
    table = UserCardPreference.__table__
    assert isinstance(table, Table)
    assert {index.name for index in table.indexes} == {
        "ix_user_card_preferences_user_updated"
    }


class _Result:
    def __init__(self, value: object):
        self.value = value

    def scalar_one(self) -> object:
        return self.value


class _Session:
    def __init__(self, result_value: object):
        self.result_value = result_value
        self.statements: list[ClauseElement] = []
        self.committed = False

    async def execute(self, statement: ClauseElement) -> _Result:
        self.statements.append(statement)
        return _Result(self.result_value)

    async def commit(self) -> None:
        self.committed = True


class _PreferencesResult:
    def __init__(self, preferences: list[object]):
        self.preferences = preferences

    def scalars(self) -> _PreferencesResult:
        return self

    def all(self) -> list[object]:
        return self.preferences


class _PreferencesSession:
    def __init__(self, preferences: list[object]):
        self.preferences = preferences

    async def execute(self, _statement: ClauseElement) -> _PreferencesResult:
        return _PreferencesResult(self.preferences)


async def test_card_preference_read_signals_recovery_and_observes_future_version(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A corrupted v1 row remains custom while future-version coexistence is logged."""
    warnings: list[tuple[str, dict[str, object]]] = []

    def _capture_warning(event: str, **context: object) -> None:
        warnings.append((event, context))

    monkeypatch.setattr(settings_service_module.logger, "warning", _capture_warning)
    timestamp = datetime(2026, 8, 6, tzinfo=UTC)
    service = SettingsService(
        cast(
            AsyncSession,
            _PreferencesSession(
                [
                    SimpleNamespace(
                        card_id=CardId.TOP_CHAMPIONS.value,
                        version=1,
                        settings={"minimum_games": "invalid"},
                        updated_at=timestamp,
                    ),
                    SimpleNamespace(
                        card_id=CardId.TOP_CHAMPIONS.value,
                        version=2,
                        settings={"minimum_games": 30},
                        updated_at=timestamp,
                    ),
                ]
            ),
        )
    )

    responses = await service.get_card_preferences(user_id=73)

    top_champions = next(
        response for response in responses if response.card_id is CardId.TOP_CHAMPIONS
    )
    assert not top_champions.is_default
    assert top_champions.requires_recovery
    assert top_champions.settings["minimumGames"] == 1
    assert any(
        event == "card_preference_future_version_ignored" for event, _ in warnings
    )


async def test_upsert_is_atomic_and_scoped_to_the_authenticated_user() -> None:
    """Concurrent writes use the composite-key upsert without a user-id input."""
    timestamp = datetime(2026, 8, 6, tzinfo=UTC)
    session = _Session(
        SimpleNamespace(
            settings={
                "minimum_games": 12,
                "minimum_win_rate": 54.5,
                "minimum_kda": 2.3,
                "included_roles": ["TOP", "JUNGLE"],
            },
            updated_at=timestamp,
        )
    )
    service = SettingsService(cast(AsyncSession, session))

    response = await service.update_card_preference(
        73,
        CardId.TOP_CHAMPIONS,
        CardPreferenceUpdate(version=1, settings=TOP_CHAMPIONS_PAYLOAD),
    )

    statement = session.statements[0]
    compiled = str(statement.compile(dialect=postgresql.dialect()))
    assert "ON CONFLICT (user_id, card_id, version) DO UPDATE" in compiled
    assert "INSERT INTO auth.user_card_preferences" in compiled
    assert response.card_id is CardId.TOP_CHAMPIONS
    assert response.settings["minimumGames"] == 12
    assert response.updated_at == timestamp
    assert session.committed


async def test_card_preference_route_uses_only_the_current_user_id() -> None:
    """A caller cannot supply a second user's identifier to the route."""
    captured: dict[str, object] = {}

    class Service:
        async def update_card_preference(
            self,
            user_id: int,
            card_id: CardId,
            update: CardPreferenceUpdate,
        ) -> str:
            captured.update(user_id=user_id, card_id=card_id, update=update)
            return "ok"

    result = await router.update_card_preference(
        CardId.RECENT_PERFORMANCE,
        CardPreferenceUpdate(version=1, settings=RECENT_PERFORMANCE_PAYLOAD),
        cast(SettingsService, Service()),
        cast(User, SimpleNamespace(id=91)),
    )

    assert result == "ok"
    assert captured["user_id"] == 91
    assert captured["card_id"] is CardId.RECENT_PERFORMANCE


async def test_card_reset_targets_only_the_current_v1_row() -> None:
    """Per-card reset leaves future-version records available to later servers."""
    session = _Session(None)
    service = SettingsService(cast(AsyncSession, session))

    response = await service.reset_card_preference(11, CardId.RECENT_PERFORMANCE)

    statement = session.statements[0]
    compiled = str(statement.compile(dialect=postgresql.dialect()))
    assert "DELETE FROM auth.user_card_preferences" in compiled
    assert "user_card_preferences.version = %(version_1)s" in compiled
    assert response.is_default
    assert response.settings["queueId"] == 420
    assert session.committed
