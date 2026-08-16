"""Deterministic Match Fetcher release, rate-limit, and diagnostic tests."""

from collections.abc import Callable
from types import SimpleNamespace
from typing import cast, override
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError as PydanticValidationError
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ServiceException
from app.core.riot_api.client import RiotAPIClient
from app.core.riot_api.constants import PRODUCT_SUPPORTED_QUEUE_IDS, Region
from app.core.riot_api.db_rate_limiter import DBRateLimiter
from app.core.riot_api.errors import RateLimitError
from app.core.riot_api.models import LeagueEntryDTO, MatchTimelineDTO
from app.features.jobs.base import BaseJob
from app.features.jobs.error_handling import RateLimitSignal
from app.features.jobs.implementations import match_fetcher as match_fetcher_module
from app.features.jobs.implementations.match_fetcher import MatchFetcherJob
from app.features.jobs.maintenance import RiotWriterMaintenanceActiveError
from app.features.jobs.models import JobConfiguration
from app.features.matches.service import MatchService, SyncablePlayer
from app.features.players.schemas import PlayerResponse
from app.features.players.service import PlayerService


class _EmptyQueryResult:
    """Minimal SQLAlchemy-result double for queue sync lookup queries."""

    def scalars(self) -> _EmptyQueryResult:
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

    async def get_match_timeline(
        self, _match_id: str, **_kwargs: object
    ) -> MatchTimelineDTO:
        return MatchTimelineDTO.model_validate(
            {
                "metadata": {"matchId": "EUN1_123", "participants": []},
                "info": {"frameInterval": 60_000, "frames": []},
            }
        )


class _NoopJob(BaseJob):
    """Small BaseJob implementation for diagnostic assertions."""

    @override
    async def execute(self, db: AsyncSession) -> None:
        return None


@pytest.mark.asyncio
async def test_match_sync_always_processes_the_complete_supported_queue_set() -> None:
    service = MatchService(cast(AsyncSession, _QueueSyncSession()))
    service._sync_single_queue_for_player = AsyncMock(return_value=0)

    await service.sync_matches_for_player(
        riot_client=cast(RiotAPIClient, object()),
        player=cast(
            SyncablePlayer, SimpleNamespace(puuid="test-puuid", platform="eun1")
        ),
    )

    assert [
        call.kwargs["queue_id"]
        for call in service._sync_single_queue_for_player.await_args_list
    ] == list(PRODUCT_SUPPORTED_QUEUE_IDS)


@pytest.mark.asyncio
async def test_ranked_queue_reports_each_stored_match_for_lp_observation() -> None:
    service = MatchService(cast(AsyncSession, _QueueSyncSession()))
    service._reprocess_match = AsyncMock()
    stored_matches: list[tuple[int, str]] = []

    await service._sync_single_queue_for_player(
        riot_client=cast(RiotAPIClient, _QueueSyncClient("16.15.1")),
        puuid="test-puuid",
        region=Region.EUROPE,
        queue_id=420,
        rate_limiter=None,
        on_failure=None,
        on_match_stored=lambda queue_id, match_id: stored_matches.append(
            (queue_id, match_id)
        ),
    )

    assert stored_matches == [(420, "EUN1_123")]


def test_explicit_analysis_queue_subset_rejects_unsupported_ids() -> None:
    service = MatchService(cast(AsyncSession, _QueueSyncSession()))

    assert service._normalize_sync_queue_ids([2400, 999999, 480, 2400]) == [
        480,
        2400,
    ]
    assert service._normalize_sync_queue_ids([999999]) == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("game_version", "expected_stored"),
    [("16.15.1", 1), ("15.24.1", 0)],
)
async def test_queue_sync_accepts_current_release_and_stops_at_historical_match(
    game_version: str,
    expected_stored: int,
) -> None:
    service = MatchService(cast(AsyncSession, _QueueSyncSession()))
    service._reprocess_match = AsyncMock()

    stored = await service._sync_single_queue_for_player(
        riot_client=cast(RiotAPIClient, _QueueSyncClient(game_version)),
        puuid="test-puuid",
        region=Region.EUROPE,
        queue_id=420,
        rate_limiter=None,
        on_failure=None,
    )

    assert stored == expected_stored
    assert service._reprocess_match.await_count == expected_stored


@pytest.mark.asyncio
async def test_queue_sync_records_recoverable_match_failure_with_safe_context() -> None:
    service = MatchService(cast(AsyncSession, _QueueSyncSession()))
    service._reprocess_match = AsyncMock(side_effect=RuntimeError("raw provider body"))
    failures: list[tuple[str, Exception, dict[str, object]]] = []

    stored = await service._sync_single_queue_for_player(
        riot_client=cast(RiotAPIClient, _QueueSyncClient("16.15.1")),
        puuid="test-puuid",
        region=Region.EUROPE,
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
    service = MatchService(cast(AsyncSession, _QueueSyncSession()))
    service._sync_single_queue_for_player = AsyncMock(
        side_effect=RateLimitError("limited", status_code=429, retry_after=7)
    )

    with pytest.raises(RateLimitError):
        await service.sync_matches_for_player(
            riot_client=cast(RiotAPIClient, object()),
            player=cast(
                SyncablePlayer, SimpleNamespace(puuid="test-puuid", platform="eun1")
            ),
        )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "fatal_error",
    [SQLAlchemyError("database unavailable"), RiotWriterMaintenanceActiveError()],
)
async def test_match_sync_propagates_fatal_writer_errors_to_the_job_layer(
    fatal_error: Exception,
) -> None:
    service = MatchService(cast(AsyncSession, _QueueSyncSession()))
    service._sync_single_queue_for_player = AsyncMock(side_effect=fatal_error)

    with pytest.raises(type(fatal_error)):
        await service.sync_matches_for_player(
            riot_client=cast(RiotAPIClient, object()),
            player=cast(
                SyncablePlayer, SimpleNamespace(puuid="test-puuid", platform="eun1")
            ),
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
            db=cast(AsyncSession, object()),
            player=cast(
                PlayerResponse, SimpleNamespace(puuid="test-puuid", game_name="Test")
            ),
            player_service=cast(
                PlayerService,
                SimpleNamespace(get_player_league=AsyncMock(return_value=None)),
            ),
            match_service=cast(MatchService, match_service),
            riot_client=cast(RiotAPIClient, object()),
            rate_limiter=cast(DBRateLimiter, object()),
        )

    assert error.value.retry_after == 7


@pytest.mark.asyncio
async def test_match_fetcher_execute_propagates_rate_limit_to_base_job(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeRiotClient:
        def __init__(self, **_kwargs: object) -> None:
            return None

        async def __aenter__(self) -> FakeRiotClient:
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
        MatchFetcherJob,
        "get_job_riot_api_client",
        AsyncMock(return_value=FakeRiotClient()),
    )

    def build_player_service(_db: AsyncSession) -> SimpleNamespace:
        return SimpleNamespace(
            get_globally_tracked_players=AsyncMock(return_value=[player]),
            get_player_league=AsyncMock(return_value=None),
        )

    def build_match_service(_db: AsyncSession) -> SimpleNamespace:
        return match_service

    def build_rate_limiter(*_args: object) -> SimpleNamespace:
        return rate_limiter

    monkeypatch.setattr(match_fetcher_module, "PlayerService", build_player_service)
    monkeypatch.setattr(match_fetcher_module, "MatchService", build_match_service)
    monkeypatch.setattr(match_fetcher_module, "DBRateLimiter", build_rate_limiter)

    job = MatchFetcherJob(job_config_id=7)
    job.job_config = cast(
        JobConfiguration, SimpleNamespace(config_json={"enabled_queue_ids": []})
    )
    job.check_control_state = AsyncMock()

    with pytest.raises(RateLimitSignal):
        await job.execute(cast(AsyncSession, object()))

    rate_limiter.release.assert_awaited_once()


@pytest.mark.asyncio
async def test_match_fetcher_processes_the_player_league_refresh_path() -> None:
    job = MatchFetcherJob(job_config_id=7)
    player_model = SimpleNamespace(
        puuid="sanitized-puuid",
        match_synced_at=None,
        league_synced_at=None,
    )
    db = SimpleNamespace(
        get=AsyncMock(return_value=player_model),
        commit=AsyncMock(),
        rollback=AsyncMock(),
    )
    player_service = SimpleNamespace(
        get_player_league=AsyncMock(return_value=None),
        update_player_league=AsyncMock(return_value=False),
    )
    match_service = SimpleNamespace(sync_matches_for_player=AsyncMock(return_value=0))
    rate_limiter = SimpleNamespace(
        acquire=AsyncMock(return_value=True),
        record_request=AsyncMock(),
    )
    player = SimpleNamespace(
        puuid="sanitized-puuid",
        platform="eun1",
        game_name="Sanitized",
    )

    await job._process_player(
        db=cast(AsyncSession, db),
        player=cast(PlayerResponse, player),
        player_service=cast(PlayerService, player_service),
        match_service=cast(MatchService, match_service),
        riot_client=cast(RiotAPIClient, object()),
        rate_limiter=cast(DBRateLimiter, rate_limiter),
    )

    player_service.update_player_league.assert_awaited_once()
    assert db.commit.await_count == 2
    assert player_model.match_synced_at is not None
    assert player_model.league_synced_at is not None
    rate_limiter.record_request.assert_awaited_once()
    assert not job.has_errors()


@pytest.mark.asyncio
async def test_recoverable_match_failure_does_not_claim_match_freshness() -> None:
    job = MatchFetcherJob(job_config_id=7)
    player_model = SimpleNamespace(
        puuid="sanitized-puuid",
        match_synced_at=None,
        league_synced_at=None,
    )
    db = SimpleNamespace(
        get=AsyncMock(return_value=player_model),
        commit=AsyncMock(),
        rollback=AsyncMock(),
    )

    async def sync_with_failure(*_args: object, **kwargs: object) -> int:
        on_failure = cast(
            Callable[[str, Exception, dict[str, object]], None],
            kwargs["on_failure"],
        )
        on_failure(
            "match synchronization",
            RuntimeError("provider failure"),
            {"queue_id": 420},
        )
        return 0

    match_service = SimpleNamespace(
        sync_matches_for_player=AsyncMock(side_effect=sync_with_failure)
    )
    player_service = SimpleNamespace(
        get_player_league=AsyncMock(return_value=None),
        update_player_league=AsyncMock(return_value=False),
    )
    rate_limiter = SimpleNamespace(
        acquire=AsyncMock(return_value=True),
        record_request=AsyncMock(),
    )

    await job._process_player(
        db=cast(AsyncSession, db),
        player=cast(
            PlayerResponse,
            SimpleNamespace(
                puuid="sanitized-puuid",
                platform="eun1",
                game_name="Sanitized",
            ),
        ),
        player_service=cast(PlayerService, player_service),
        match_service=cast(MatchService, match_service),
        riot_client=cast(RiotAPIClient, object()),
        rate_limiter=cast(DBRateLimiter, rate_limiter),
    )

    assert player_model.match_synced_at is None
    assert player_model.league_synced_at is not None
    assert job.has_errors()


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


def test_job_diagnostics_retain_wrapped_validation_fields() -> None:
    job = _NoopJob(job_config_id=7)
    # The fixture is malformed on purpose: `queueType` is missing, which is what
    # produces the wrapped ValidationError under test. It goes through
    # `model_validate` rather than the constructor because a provider payload is
    # untyped data at that boundary, and a direct call would be a static error
    # for exactly the reason the test is asserting at runtime.
    try:
        LeagueEntryDTO.model_validate(
            {
                "tier": "GOLD",
                "rank": "II",
                "leaguePoints": 42,
                "wins": 12,
                "losses": 8,
                "veteran": False,
                "inactive": False,
                "freshBlood": False,
                "hotStreak": False,
            }
        )
    except PydanticValidationError as validation_error:
        wrapped_error = ServiceException(
            "validation failed",
            original_error=validation_error,
        )
    else:  # pragma: no cover - protects the test fixture itself
        raise AssertionError("Malformed league fixture unexpectedly validated")

    job.record_error(wrapped_error, operation="player league update")

    assert job.execution_log["errors"][0] == {
        "operation": "player league update",
        "error_type": "ValidationError",
        "validation_fields": ["queueType"],
    }
