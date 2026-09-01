"""Credential-generation and server-authoritative Riot health regressions."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock, Mock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.riot_api.client import RiotAPIClient
from app.core.riot_api.credential_health import (
    RiotAPIKey,
    RiotCredentialEvidence,
    RiotCredentialHealth,
    RiotCredentialStatus,
    _replace_generation,
    apply_riot_credential_evidence,
)
from app.core.riot_api.errors import RateLimitError
from app.features.settings import service as settings_service_module
from app.features.settings.schemas import SettingUpdate
from app.features.settings.service import SettingsService


def _health(
    *,
    generation: str = "current-generation",
    status: RiotCredentialStatus = RiotCredentialStatus.UNKNOWN,
    evidence_at: datetime,
    revision: int = 1,
) -> RiotCredentialHealth:
    return cast(
        RiotCredentialHealth,
        SimpleNamespace(
            id=1,
            generation=generation,
            db_key_id=7,
            status=status.value,
            evidence=RiotCredentialEvidence.CONFIGURED.value,
            evidence_at=evidence_at,
            revision=revision,
            recovered_at=None,
            recovery_revision=None,
        ),
    )


def test_new_generation_resets_old_failure_without_key_fingerprint() -> None:
    observed_at = datetime(2026, 8, 11, tzinfo=UTC)
    health = _health(
        status=RiotCredentialStatus.INVALID,
        evidence_at=observed_at,
        revision=4,
    )

    _replace_generation(health, db_key_id=8, now=observed_at + timedelta(seconds=1))

    assert health.generation != "current-generation"
    assert health.status == RiotCredentialStatus.UNKNOWN.value
    assert health.evidence == RiotCredentialEvidence.CONFIGURED.value
    assert health.revision == 5
    assert health.recovered_at is None


def test_ordered_evidence_rejects_stale_generation_and_late_old_request() -> None:
    started_at = datetime(2026, 8, 11, tzinfo=UTC)
    health = _health(evidence_at=started_at)

    assert apply_riot_credential_evidence(
        health,
        generation="current-generation",
        status=RiotCredentialStatus.INVALID,
        evidence_at=started_at + timedelta(seconds=2),
    )
    assert health.status == RiotCredentialStatus.INVALID.value
    assert health.revision == 2

    assert not apply_riot_credential_evidence(
        health,
        generation="current-generation",
        status=RiotCredentialStatus.VALID,
        evidence_at=started_at + timedelta(seconds=1),
    )
    assert not apply_riot_credential_evidence(
        health,
        generation="old-generation",
        status=RiotCredentialStatus.VALID,
        evidence_at=started_at + timedelta(seconds=3),
    )
    assert health.status == RiotCredentialStatus.INVALID.value

    assert apply_riot_credential_evidence(
        health,
        generation="current-generation",
        status=RiotCredentialStatus.VALID,
        evidence_at=started_at + timedelta(seconds=4),
    )
    assert health.status == RiotCredentialStatus.VALID.value
    assert health.revision == 3
    assert health.recovery_revision == 3


async def test_only_provider_acceptance_or_rejection_changes_health() -> None:
    callback = AsyncMock()
    client = RiotAPIClient(
        api_key="RGAPI-test-only",
        credential_health_callback=callback,
    )
    observed_at = datetime(2026, 8, 11, tzinfo=UTC)

    for status_code in (200, 204, 404):
        await client._record_credential_health(status_code, observed_at)
    for status_code in (400, 429, 500, 503):
        await client._record_credential_health(status_code, observed_at)
    await client._record_credential_health(401, observed_at)
    await client._record_credential_health(403, observed_at)

    assert [call.args[0] for call in callback.await_args_list] == [
        RiotCredentialStatus.VALID,
        RiotCredentialStatus.VALID,
        RiotCredentialStatus.VALID,
        RiotCredentialStatus.INVALID,
        RiotCredentialStatus.INVALID,
    ]


def test_losing_the_only_key_reports_missing_rather_than_unknown() -> None:
    """`db_key_id` alone decides status now that there is no `source` column."""
    observed_at = datetime(2026, 8, 11, tzinfo=UTC)
    health = _health(status=RiotCredentialStatus.VALID, evidence_at=observed_at)

    _replace_generation(health, db_key_id=None, now=observed_at)

    assert health.db_key_id is None
    assert health.status == RiotCredentialStatus.MISSING.value
    assert health.evidence == RiotCredentialEvidence.MISSING.value


async def test_service_status_answers_from_the_shared_health_snapshot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """One endpoint now, so the pair can no longer disagree.

    A second status endpoint caches separately and is never refetched, so an
    expired key flips the header banner and leaves the card stale.
    """
    observed_at = datetime(2026, 8, 11, tzinfo=UTC)
    snapshot = SimpleNamespace(
        status=RiotCredentialStatus.INVALID,
        evidence=RiotCredentialEvidence.CREDENTIAL_REJECTED,
        evidence_at=observed_at,
        revision=9,
        recovered_at=None,
        recovery_revision=None,
    )
    monkeypatch.setattr(
        settings_service_module,
        "synchronize_riot_credential_health",
        AsyncMock(return_value=(SimpleNamespace(), snapshot)),
    )
    service = SettingsService(cast(AsyncSession, SimpleNamespace()))

    user_status = await service.get_service_status()

    assert user_status.credential_status == "invalid"
    assert user_status.health_revision == 9
    assert user_status.is_under_maintenance is True
    assert user_status.reason == "api_key_invalid"
    assert user_status.observed_at == observed_at


async def test_candidate_validation_keeps_transient_failure_distinct(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    candidate_client = SimpleNamespace(
        start_session=AsyncMock(),
        close=AsyncMock(),
    )
    monkeypatch.setattr(
        settings_service_module,
        "RiotAPIClient",
        Mock(return_value=candidate_client),
    )
    service = SettingsService(cast(AsyncSession, SimpleNamespace()))
    service._test_api_key_with_client = AsyncMock(
        side_effect=RateLimitError("limited", status_code=429, retry_after=60)
    )

    result = await service.validate_riot_api_key("RGAPI-" + "x" * 36)

    assert result.valid is False
    assert result.status == "unavailable"
    assert result.message == "Riot API validation is temporarily unavailable"
    candidate_client.close.assert_awaited_once()


async def test_saving_a_key_takes_key_locks_before_the_health_lock(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Saving must lock key rows first, the order every read path uses.

    `synchronize_riot_credential_health` locks key then health; binding health
    first reverses that and a save racing a read deadlocks.
    """
    events: list[str] = []
    saved_at = datetime(2026, 8, 11, tzinfo=UTC)

    async def _execute(statement: object) -> object:
        events.append(type(statement).__name__)
        return SimpleNamespace(scalar_one_or_none=lambda: None)

    async def _flush() -> None:
        for pending in added:
            pending.id = 12
            pending.added_at = saved_at

    added: list[RiotAPIKey] = []
    database = SimpleNamespace(
        execute=_execute,
        add=added.append,
        flush=_flush,
        commit=AsyncMock(),
        refresh=AsyncMock(),
    )

    async def _mark(*_args: object, **_kwargs: object) -> None:
        events.append("bind_health")

    monkeypatch.setattr(
        settings_service_module, "mark_database_credential_valid", _mark
    )
    service = SettingsService(cast(AsyncSession, database))
    service.validate_riot_api_key = AsyncMock(
        return_value=SimpleNamespace(valid=True, status="valid", message="ok")
    )

    response = await service.update_setting(
        "riot_api_key", SettingUpdate(value="RGAPI-" + "z" * 36)
    )

    assert events == ["Select", "Delete", "bind_health"]
    assert response.masked_value == "RGAPI-...zzzz"
