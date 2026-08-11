"""Credential-generation and server-authoritative Riot health regressions."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock, Mock

import pytest

from app.core.riot_api.client import RiotAPIClient
from app.core.riot_api.credential_health import (
    RiotCredentialEvidence,
    RiotCredentialHealth,
    RiotCredentialSource,
    RiotCredentialStatus,
    _environment_generation,
    _replace_generation,
    apply_riot_credential_evidence,
)
from app.core.riot_api.errors import RateLimitError
from app.features.settings import service as settings_service_module
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
            source=RiotCredentialSource.DATABASE.value,
            db_key_id=7,
            environment_generation=None,
            status=status.value,
            evidence=RiotCredentialEvidence.CONFIGURED.value,
            evidence_at=evidence_at,
            revision=revision,
            recovered_at=None,
            recovery_revision=None,
        ),
    )


def test_new_generation_resets_old_failure_without_key_fingerprint() -> None:
    observed_at = datetime(2026, 8, 11, tzinfo=timezone.utc)
    health = _health(
        status=RiotCredentialStatus.INVALID,
        evidence_at=observed_at,
        revision=4,
    )

    _replace_generation(
        health,
        source=RiotCredentialSource.DATABASE,
        db_key_id=8,
        environment_generation=None,
        now=observed_at + timedelta(seconds=1),
    )

    assert health.generation != "current-generation"
    assert health.status == RiotCredentialStatus.UNKNOWN.value
    assert health.evidence == RiotCredentialEvidence.CONFIGURED.value
    assert health.revision == 5
    assert health.recovered_at is None


def test_ordered_evidence_rejects_stale_generation_and_late_old_request() -> None:
    started_at = datetime(2026, 8, 11, tzinfo=timezone.utc)
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


@pytest.mark.asyncio
async def test_only_provider_acceptance_or_rejection_changes_health() -> None:
    callback = AsyncMock()
    client = RiotAPIClient(
        api_key="RGAPI-test-only",
        credential_health_callback=callback,
    )
    observed_at = datetime(2026, 8, 11, tzinfo=timezone.utc)

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


def test_environment_generation_is_explicit_or_runtime_random(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("RIOT_API_KEY_VERSION", "deployment-42")
    assert _environment_generation("RGAPI-test-one") == "version:deployment-42"
    with pytest.raises(ValueError, match="must change"):
        _environment_generation("RGAPI-test-two")

    monkeypatch.setenv("RIOT_API_KEY_VERSION", "RGAPI-not-a-safe-version")
    with pytest.raises(ValueError, match="must not contain"):
        _environment_generation("RGAPI-test-one")

    monkeypatch.delenv("RIOT_API_KEY_VERSION", raising=False)
    first = _environment_generation("RGAPI-test-one")
    assert first == _environment_generation("RGAPI-test-one")
    assert first != _environment_generation("RGAPI-test-two")
    assert "RGAPI" not in first


@pytest.mark.asyncio
async def test_admin_and_user_status_share_the_same_health_snapshot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    observed_at = datetime(2026, 8, 11, tzinfo=timezone.utc)
    snapshot = SimpleNamespace(
        has_db_key=True,
        has_env_key=True,
        source=RiotCredentialSource.DATABASE,
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
    service = SettingsService(SimpleNamespace())  # type: ignore[arg-type]

    admin_status = await service.get_api_key_status()
    user_status = await service.get_service_status()

    assert admin_status.active_source == user_status.active_source == "db"
    assert admin_status.credential_status == user_status.credential_status == "invalid"
    assert admin_status.health_revision == user_status.health_revision == 9
    assert user_status.is_under_maintenance is True
    assert user_status.reason == "api_key_invalid"


@pytest.mark.asyncio
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
    service = SettingsService(SimpleNamespace())  # type: ignore[arg-type]
    service._test_api_key_with_client = AsyncMock(  # type: ignore[method-assign]
        side_effect=RateLimitError("limited", status_code=429, retry_after=60)
    )

    result = await service.validate_riot_api_key("RGAPI-" + "x" * 36)

    assert result.valid is False
    assert result.status == "unavailable"
    assert result.message == "Riot API validation is temporarily unavailable"
    candidate_client.close.assert_awaited_once()
