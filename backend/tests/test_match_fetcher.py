"""Deterministic Match Fetcher release, rate-limit, and diagnostic tests."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.core.riot_api.errors import RateLimitError
from app.features.jobs.base import BaseJob
from app.features.jobs.error_handling import RateLimitSignal
from app.features.jobs.implementations import match_fetcher as match_fetcher_module
from app.features.jobs.implementations.match_fetcher import MatchFetcherJob
from app.features.matches.service import MatchService


class _EmptyQueryResult:
    """Minimal SQLAlchemy-result double for queue sync lookup queries."""

    def scalars(self) -> "_EmptyQueryResult":
        return self

    def all(self) -> list[object]:
        return []


class _QueueSyncSession:
    """Session double returning no persisted matches or timeline rows."""

    async def execute(self, _statement: object) -> _EmptyQueryResult:
        return _EmptyQueryResult()


class _QueueSyncClient:
    """Riot client double with one match in the requested release year."""

    def __init__(self, game_version: str) -> None:
        self.game_version = game_version

    async def get_match_list_by_puuid(self, **_kwargs: object) -> SimpleNamespace:
        return SimpleNamespace(match_ids=["EUN1_123"])

    async def get_match(self, _match_id: str, **_kwargs: object) -> SimpleNamespace:
        return SimpleNamespace(info=SimpleNamespace(game_version=self.game_version))

    async def get_match_timeline(self, _match_id: str, **_kwargs: object) -> dict:
        return {}


class _NoopJob(BaseJob):
    """Small BaseJob implementation for diagnostic assertions."""

    async def execute(self, _db: object) -> None:
        return None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("game_version", "expected_stored"),
    [("26.15.1", 1), ("16.24.1", 0)],
)
async def test_queue_sync_accepts_current_release_and_stops_at_historical_match(
    game_version: str,
    expected_stored: int,
) -> None:
    service = MatchService(_QueueSyncSession())  # type: ignore[arg-type]
    service._reprocess_match = AsyncMock()  # type: ignore[method-assign]

    stored = await service._sync_single_queue_for_player(
        riot_client=_QueueSyncClient(game_version),
        puuid="test-puuid",
        region="EUROPE",
        queue_id=420,
        rate_limiter=None,
        on_failure=None,
    )

    assert stored == expected_stored
    assert service._reprocess_match.await_count == expected_stored


@pytest.mark.asyncio
async def test_queue_sync_records_recoverable_match_failure_with_safe_context() -> None:
    service = MatchService(_QueueSyncSession())  # type: ignore[arg-type]
    service._reprocess_match = AsyncMock(side_effect=RuntimeError("raw provider body"))  # type: ignore[method-assign]
    failures: list[tuple[str, Exception, dict[str, object]]] = []

    stored = await service._sync_single_queue_for_player(
        riot_client=_QueueSyncClient("26.15.1"),
        puuid="test-puuid",
        region="EUROPE",
        queue_id=420,
        rate_limiter=None,
        on_failure=lambda operation, error, context: failures.append(
            (operation, error, context)
        ),
    )

    assert stored == 0
    assert failures[0][0] == "match synchronization"
    assert failures[0][2] == {"queue_id": 420, "match_id": "EUN1_123"}


@pytest.mark.asyncio
async def test_match_sync_propagates_rate_limit_to_the_job_layer() -> None:
    service = MatchService(_QueueSyncSession())  # type: ignore[arg-type]
    service._sync_single_queue_for_player = AsyncMock(  # type: ignore[method-assign]
        side_effect=RateLimitError("limited", status_code=429, retry_after=7)
    )

    with pytest.raises(RateLimitError):
        await service.sync_matches_for_player(
            riot_client=object(),
            player=SimpleNamespace(puuid="test-puuid", platform="eun1"),
            enabled_queue_ids=[420],
        )


@pytest.mark.asyncio
async def test_match_fetcher_converts_rate_limit_to_a_non_failure_signal() -> None:
    job = MatchFetcherJob(job_config_id=7)
    match_service = SimpleNamespace(
        sync_matches_for_player=AsyncMock(
            side_effect=RateLimitError("limited", status_code=429, retry_after=7)
        )
    )

    with pytest.raises(RateLimitSignal) as error:
        await job._process_player(
            db=object(),
            player=SimpleNamespace(puuid="test-puuid", game_name="Test"),
            player_service=object(),
            match_service=match_service,
            riot_client=object(),
            rate_limiter=object(),
            enabled_queue_ids=[420],
        )

    assert error.value.retry_after == 7


@pytest.mark.asyncio
async def test_match_fetcher_execute_propagates_rate_limit_to_base_job(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeRiotClient:
        def __init__(self, **_kwargs: object) -> None:
            return None

        async def __aenter__(self) -> "FakeRiotClient":
            return self

        async def __aexit__(self, *_args: object) -> None:
            return None

        def get_api_calls(self) -> list[object]:
            return []

    rate_limiter = SimpleNamespace(release=AsyncMock())
    match_service = SimpleNamespace(
        sync_matches_for_player=AsyncMock(
            side_effect=RateLimitError("limited", status_code=429, retry_after=7)
        )
    )
    player = SimpleNamespace(puuid="test-puuid", game_name="Test")

    monkeypatch.setattr(
        match_fetcher_module,
        "get_riot_api_key",
        AsyncMock(return_value="test-key"),
    )
    monkeypatch.setattr(match_fetcher_module, "RiotAPIClient", FakeRiotClient)
    monkeypatch.setattr(
        match_fetcher_module,
        "PlayerService",
        lambda _db: SimpleNamespace(
            get_globally_tracked_players=AsyncMock(return_value=[player])
        ),
    )
    monkeypatch.setattr(match_fetcher_module, "MatchService", lambda _db: match_service)
    monkeypatch.setattr(
        match_fetcher_module,
        "DBRateLimiter",
        lambda *_args: rate_limiter,
    )

    job = MatchFetcherJob(job_config_id=7)
    job.job_config = SimpleNamespace(config_json={"enabled_queue_ids": [420]})
    job.check_control_state = AsyncMock()

    with pytest.raises(RateLimitSignal):
        await job.execute(object())

    rate_limiter.release.assert_awaited_once()


def test_job_error_diagnostics_exclude_raw_error_text_and_unreviewed_context() -> None:
    job = _NoopJob(job_config_id=7)
    job.record_error(
        RateLimitError("RGAPI-secret-value", status_code=429),
        operation="match synchronization",
        context={
            "queue_id": 420,
            "match_id": "EUN1_123",
            "payload": {"token": "must-not-persist"},
        },
    )

    diagnostic = job.execution_log["errors"][0]
    assert diagnostic == {
        "operation": "match synchronization",
        "error_type": "RateLimitError",
        "status_code": 429,
        "context": {"queue_id": 420, "match_id": "EUN1_123"},
    }
    assert "RGAPI-secret-value" not in str(diagnostic)
    assert job._get_error_summary() == (
        "Job completed with 1 error(s); first failure: "
        "match synchronization (RateLimitError)"
    )
