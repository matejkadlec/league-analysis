"""Deterministic Match Fetcher release, rate-limit, and diagnostic tests."""

from collections.abc import Callable
from datetime import UTC, datetime
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
from app.core.riot_api.errors import AuthenticationError, RateLimitError
from app.core.riot_api.models import LeagueEntryDTO, MatchTimelineDTO
from app.features.jobs.base import BaseJob, RateLimitSignal
from app.features.jobs.implementations import match_fetcher as match_fetcher_module
from app.features.jobs.implementations.match_fetcher import MatchFetcherJob
from app.features.jobs.maintenance import RiotWriterMaintenanceActiveError
from app.features.jobs.models import JobConfiguration
from app.features.matches.service import MatchService
from app.features.players.models import Player
from app.features.players.service import PlayerService


def _player(puuid: str = "sanitized-puuid") -> Player:
    """One unattached row, which is what the job layer now passes around."""
    return Player(
        puuid=puuid,
        game_name="Sanitized",
        tag_line="EUN1",
        platform="eun1",
        summoner_level=30,
        profile_icon_id=29,
    )


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


class _CapturingQueueSyncClient(_QueueSyncClient):
    """`_QueueSyncClient`, keeping what each id page actually asked Riot for."""

    def __init__(self, game_version: str) -> None:
        super().__init__(game_version)
        self.id_page_calls: list[dict[str, object]] = []

    @override
    async def get_match_list_by_puuid(self, **kwargs: object) -> SimpleNamespace:
        self.id_page_calls.append(kwargs)
        return SimpleNamespace(match_ids=["EUN1_123"])


class _NoopJob(BaseJob):
    """Small BaseJob implementation for diagnostic assertions."""

    @override
    async def execute(self, db: AsyncSession) -> None:
        return None


async def test_match_sync_always_processes_the_complete_supported_queue_set() -> None:
    service = MatchService(cast(AsyncSession, _QueueSyncSession()))
    service._sync_single_queue_for_player = AsyncMock(return_value=0)

    await service.sync_matches_for_player(
        riot_client=cast(RiotAPIClient, object()),
        player=_player("test-puuid"),
    )

    assert [
        call.kwargs["queue_id"]
        for call in service._sync_single_queue_for_player.await_args_list
    ] == list(PRODUCT_SUPPORTED_QUEUE_IDS)


async def test_ranked_queue_reports_each_stored_match_for_lp_observation() -> None:
    service = MatchService(cast(AsyncSession, _QueueSyncSession()))
    service._reprocess_match = AsyncMock()
    stored_matches: list[tuple[int, str]] = []

    await service._sync_single_queue_for_player(
        riot_client=cast(RiotAPIClient, _QueueSyncClient("16.15.1")),
        puuid="test-puuid",
        region=Region.EUROPE,
        queue_id=420,
        on_failure=None,
        on_match_stored=lambda queue_id, match_id: stored_matches.append(
            (queue_id, match_id)
        ),
    )

    assert stored_matches == [(420, "EUN1_123")]


@pytest.mark.parametrize(
    ("game_version", "expected_stored"),
    [
        ("16.15.1", 1),
        ("15.24.1", 0),
        # A future Riot major must keep syncing. The queue-done bool means
        # "everything below this is older", so answering False for 17.x stops
        # ingestion for every player and every queue on the day Riot ships it.
        ("17.1.1", 1),
        ("100.1.1", 1),
        # Unparseable is current: storing one extra match beats stopping.
        ("preseason", 1),
    ],
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
        on_failure=None,
    )

    assert stored == expected_stored
    assert service._reprocess_match.await_count == expected_stored


async def test_queue_sync_records_recoverable_match_failure_with_safe_context() -> None:
    service = MatchService(cast(AsyncSession, _QueueSyncSession()))
    service._reprocess_match = AsyncMock(side_effect=RuntimeError("raw provider body"))
    failures: list[tuple[str, Exception, dict[str, object]]] = []

    stored = await service._sync_single_queue_for_player(
        riot_client=cast(RiotAPIClient, _QueueSyncClient("16.15.1")),
        puuid="test-puuid",
        region=Region.EUROPE,
        queue_id=420,
        on_failure=lambda operation, error, context: failures.append(
            (operation, error, context)
        ),
    )

    assert stored == 0
    assert failures[0][0] == "match synchronization"
    assert failures[0][2] == {"queue_id": 420, "match_id": "EUN1_123"}


async def test_match_sync_propagates_rate_limit_to_the_job_layer() -> None:
    service = MatchService(cast(AsyncSession, _QueueSyncSession()))
    service._sync_single_queue_for_player = AsyncMock(
        side_effect=RateLimitError("limited", status_code=429, retry_after=7)
    )

    with pytest.raises(RateLimitError):
        await service.sync_matches_for_player(
            riot_client=cast(RiotAPIClient, object()),
            player=_player("test-puuid"),
        )


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
            player=_player("test-puuid"),
        )


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
            player=_player("test-puuid"),
            player_service=cast(
                PlayerService,
                SimpleNamespace(get_player_league=AsyncMock(return_value=None)),
            ),
            match_service=cast(MatchService, match_service),
            riot_client=cast(RiotAPIClient, object()),
        )

    assert error.value.retry_after == 7


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

    match_service = SimpleNamespace(
        sync_matches_for_player=AsyncMock(
            side_effect=RateLimitError("limited", status_code=429, retry_after=7)
        )
    )
    player = _player("test-puuid")

    monkeypatch.setattr(
        MatchFetcherJob,
        "get_job_riot_api_client",
        AsyncMock(return_value=FakeRiotClient()),
    )

    def build_player_service(_db: AsyncSession) -> SimpleNamespace:
        return SimpleNamespace(get_player_league=AsyncMock(return_value=None))

    def build_match_service(_db: AsyncSession) -> SimpleNamespace:
        return match_service

    monkeypatch.setattr(match_fetcher_module, "PlayerService", build_player_service)
    monkeypatch.setattr(match_fetcher_module, "MatchService", build_match_service)

    job = MatchFetcherJob(job_config_id=7)
    job.job_config = cast(JobConfiguration, SimpleNamespace(config_json={}))
    job.check_control_state = AsyncMock()
    # Player resolution lives on PlayerTargetsMixin._load_tracked_puuids now; this test
    # is about rate-limit propagation, not about resolution.
    monkeypatch.setattr(
        MatchFetcherJob,
        "_load_tracked_puuids",
        AsyncMock(return_value=[player.puuid]),
    )
    db = SimpleNamespace(get=AsyncMock(return_value=player))

    with pytest.raises(RateLimitSignal):
        await job.execute(cast(AsyncSession, db))


async def test_match_fetcher_processes_the_player_league_refresh_path() -> None:
    job = MatchFetcherJob(job_config_id=7)
    db = SimpleNamespace(commit=AsyncMock(), rollback=AsyncMock())
    player_service = SimpleNamespace(
        get_player_league=AsyncMock(return_value=None),
        update_player_league=AsyncMock(return_value=False),
    )
    match_service = SimpleNamespace(sync_matches_for_player=AsyncMock(return_value=0))
    player = _player()

    await job._process_player(
        db=cast(AsyncSession, db),
        player=player,
        player_service=cast(PlayerService, player_service),
        match_service=cast(MatchService, match_service),
        riot_client=cast(RiotAPIClient, object()),
    )

    player_service.update_player_league.assert_awaited_once()
    assert db.commit.await_count == 2
    assert player.match_synced_at is not None
    assert player.league_synced_at is not None
    assert not job.has_errors()


async def test_recoverable_match_failure_does_not_claim_match_freshness() -> None:
    job = MatchFetcherJob(job_config_id=7)
    db = SimpleNamespace(commit=AsyncMock(), rollback=AsyncMock(), refresh=AsyncMock())
    player = _player()

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

    await job._process_player(
        db=cast(AsyncSession, db),
        player=player,
        player_service=cast(PlayerService, player_service),
        match_service=cast(MatchService, match_service),
        riot_client=cast(RiotAPIClient, object()),
    )

    assert player.match_synced_at is None
    assert player.league_synced_at is not None
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


def _wrap_a_malformed_league_entry() -> None:
    """Reproduce the one wrapping production performs, outside the raises block.

    The fixture omits `queueType` on purpose, which is what produces the
    wrapped ValidationError under test. `raise ... from` is the only wrapping
    production performs, now that `ServiceException`'s second chain is gone.
    """
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
        raise ServiceException("validation failed") from validation_error


def test_job_diagnostics_retain_wrapped_validation_fields() -> None:
    job = _NoopJob(job_config_id=7)

    with pytest.raises(ServiceException) as excinfo:
        _wrap_a_malformed_league_entry()

    job.record_error(excinfo.value, operation="player league update")

    assert job.execution_log["errors"][0] == {
        "operation": "player league update",
        "error_type": "ValidationError",
        "validation_fields": ["queueType"],
    }


async def test_player_error_handler_asks_the_loop_to_stop_on_an_api_key_error() -> None:
    """The handler's boolean is the whole stop-vs-continue decision.

    `_process_tracked_players` breaks on True and carries on otherwise, so
    these three cases are the job's entire policy for a failing player and
    were previously asserted nowhere.
    """
    job = MatchFetcherJob(job_config_id=7)
    db = SimpleNamespace(rollback=AsyncMock())

    should_stop = await job._handle_player_processing_error(
        cast(AsyncSession, db), "sanitized-puuid", AuthenticationError("rejected")
    )

    assert should_stop is True
    assert job.has_api_key_error() is True
    assert job.execution_log["errors"][0]["operation"] == "player synchronization"
    db.rollback.assert_not_awaited()


async def test_player_error_handler_continues_after_a_recoverable_error() -> None:
    job = MatchFetcherJob(job_config_id=7)
    db = SimpleNamespace(rollback=AsyncMock())

    should_stop = await job._handle_player_processing_error(
        cast(AsyncSession, db), "sanitized-puuid", RuntimeError("one bad player")
    )

    assert should_stop is False
    assert job.has_api_key_error() is False
    db.rollback.assert_awaited_once()


async def test_player_error_handler_reraises_a_database_error_without_recording() -> (
    None
):
    job = MatchFetcherJob(job_config_id=7)
    db = SimpleNamespace(rollback=AsyncMock())

    with pytest.raises(SQLAlchemyError):
        await job._handle_player_processing_error(
            cast(AsyncSession, db),
            "sanitized-puuid",
            SQLAlchemyError("session is gone"),
        )

    assert job.execution_log.get("errors", []) == []
    db.rollback.assert_awaited_once()


async def test_a_second_api_key_error_is_not_recorded_twice() -> None:
    """The inner league handler records first and re-raises into this one.

    Without the short-circuit the same rejected key is written to the
    execution log twice for one player, which is how a single expired key
    reads as a run full of distinct failures.
    """
    job = MatchFetcherJob(job_config_id=7)
    db = SimpleNamespace(rollback=AsyncMock())
    job.record_error(
        AuthenticationError("rejected"),
        operation="player league update",
        is_api_key_error=True,
    )

    should_stop = await job._handle_player_processing_error(
        cast(AsyncSession, db), "sanitized-puuid", AuthenticationError("rejected")
    )

    assert should_stop is True
    assert len(job.execution_log["errors"]) == 1


async def test_every_id_page_is_bounded_to_a_release_window_in_epoch_seconds() -> None:
    """Riot's own filter, so a release we would reject is never even listed.

    Asserted as a date, not against the constant: read as milliseconds the same
    integer asks for the year ~57000 and Riot answers with nothing, which the
    client's validator does not catch -- it only rejects negatives.
    """
    client = _CapturingQueueSyncClient("16.15.1")
    service = MatchService(cast(AsyncSession, _QueueSyncSession()))
    service._reprocess_match = AsyncMock()

    await service._sync_single_queue_for_player(
        riot_client=cast(RiotAPIClient, client),
        puuid="test-puuid",
        region=Region.EUROPE,
        queue_id=420,
        on_failure=None,
    )

    start_time = client.id_page_calls[0]["start_time"]
    assert isinstance(start_time, int)
    floor = datetime.fromtimestamp(start_time, UTC)
    # Patch 16.1 landed 2026-01-08 and 15.x ran to 2026-01-03. Below that
    # window the floor filters nothing and restores the full walk; above it,
    # current matches are dropped in silence.
    assert datetime(2025, 12, 1, tzinfo=UTC) < floor < datetime(2026, 1, 8, tzinfo=UTC)
