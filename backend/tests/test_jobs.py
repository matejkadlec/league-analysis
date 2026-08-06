"""Background-job configuration and error-boundary tests."""

from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.core.riot_api.errors import AuthenticationError, RateLimitError
from app.features.jobs.base import BaseJob
from app.features.jobs.error_handling import RateLimitSignal, handle_riot_api_errors
from app.features.jobs.maintenance import (
    RIOT_MAINTENANCE_MODE_KEY,
    is_riot_writer_maintenance_active,
    preserve_riot_writer_maintenance_mode,
)
from app.features.jobs.models import ExecutionType, JobStatus, JobType
from app.features.jobs.queue_config import (
    MATCH_FETCHER_DEFAULT_QUEUE_IDS,
    get_enabled_match_fetcher_queue_ids,
    has_enabled_match_fetcher_queue,
    normalize_match_fetcher_config,
)
from app.features.jobs.schemas import JobConfigurationUpdate
from app.features.jobs.service import JobService


def test_queue_configuration_defaults_and_preserves_known_order() -> None:
    assert get_enabled_match_fetcher_queue_ids(None) == MATCH_FETCHER_DEFAULT_QUEUE_IDS
    assert get_enabled_match_fetcher_queue_ids({"enabled_queue_ids": []}) == []
    assert get_enabled_match_fetcher_queue_ids(
        {"enabled_queue_ids": [450, "420", 999, 420]}
    ) == [420, 450]
    assert normalize_match_fetcher_config({"other": "value"}) == {
        "other": "value",
        "enabled_queue_ids": MATCH_FETCHER_DEFAULT_QUEUE_IDS,
    }
    assert not has_enabled_match_fetcher_queue({"enabled_queue_ids": []})


@pytest.mark.asyncio
async def test_rate_limit_is_converted_to_job_signal() -> None:
    @handle_riot_api_errors(operation="fetch matches")
    async def failing_job() -> None:
        raise RateLimitError("limited", status_code=429, retry_after=7)

    with pytest.raises(RateLimitSignal) as error:
        await failing_job()
    assert error.value.retry_after == 7


@pytest.mark.asyncio
async def test_authentication_errors_remain_fatal() -> None:
    @handle_riot_api_errors(operation="fetch player", critical=False)
    async def failing_job() -> None:
        raise AuthenticationError("expired", status_code=401)

    with pytest.raises(AuthenticationError):
        await failing_job()


@pytest.mark.asyncio
async def test_noncritical_job_error_returns_none() -> None:
    @handle_riot_api_errors(operation="optional lookup", critical=False)
    async def failing_job() -> None:
        raise RuntimeError("fixture failure")

    assert await failing_job() is None


def test_riot_maintenance_mode_blocks_only_regular_writer_jobs() -> None:
    """Cleanup cannot block non-writing tests or unrelated future job types."""
    config = SimpleNamespace(
        job_type=JobType.MATCH_FETCHER,
        config_json={RIOT_MAINTENANCE_MODE_KEY: True},
    )

    assert is_riot_writer_maintenance_active(config, ExecutionType.REGULAR)
    assert not is_riot_writer_maintenance_active(config, ExecutionType.TEST)
    assert not is_riot_writer_maintenance_active(
        SimpleNamespace(
            job_type=JobType.PLAYER_UPDATER,
            config_json={RIOT_MAINTENANCE_MODE_KEY: False},
        ),
        ExecutionType.REGULAR,
    )


def test_job_configuration_updates_preserve_an_active_maintenance_interlock() -> None:
    """The jobs API cannot accidentally restart an emptied local database."""
    assert preserve_riot_writer_maintenance_mode(
        JobType.MATCH_FETCHER,
        {RIOT_MAINTENANCE_MODE_KEY: True, "enabled_queue_ids": [420]},
        {"enabled_queue_ids": [440]},
    ) == {
        RIOT_MAINTENANCE_MODE_KEY: True,
        "enabled_queue_ids": [440],
    }
    assert preserve_riot_writer_maintenance_mode(
        JobType.PLAYER_UPDATER,
        {RIOT_MAINTENANCE_MODE_KEY: True},
        None,
    ) == {RIOT_MAINTENANCE_MODE_KEY: True}
    assert preserve_riot_writer_maintenance_mode(
        JobType.MATCH_FETCHER,
        {},
        {"enabled_queue_ids": []},
    ) == {"enabled_queue_ids": []}


@pytest.mark.asyncio
async def test_job_configuration_update_row_locks_before_merging_interlock(
    monkeypatch,
) -> None:
    """A queue-toggle write cannot overwrite cleanup's interlock from a stale read."""
    job = SimpleNamespace(
        id=7,
        job_type=JobType.MATCH_FETCHER,
        config_json={RIOT_MAINTENANCE_MODE_KEY: True, "enabled_queue_ids": [420]},
        name="match fetcher",
        is_active=True,
        is_paused=False,
    )

    class Result:
        def scalar_one_or_none(self):
            return job

    class Session:
        def __init__(self) -> None:
            self.statements: list[object] = []

        async def execute(self, statement: object) -> Result:
            self.statements.append(statement)
            return Result()

        async def commit(self) -> None:
            return None

        async def refresh(self, _job: object) -> None:
            return None

    monkeypatch.setattr(
        JobService, "_to_job_response", staticmethod(lambda value: value)
    )
    session = Session()
    service = JobService(session)  # type: ignore[arg-type]

    updated = await service.update_job_configuration(
        7,
        JobConfigurationUpdate(config_json={"enabled_queue_ids": [440]}),
    )

    statement = session.statements[0]
    assert getattr(statement, "_for_update_arg") is not None
    assert updated.config_json == {
        RIOT_MAINTENANCE_MODE_KEY: True,
        "enabled_queue_ids": [440],
    }


class _MaintenanceBlockedJob(BaseJob):
    """Small BaseJob double that records an unexpected gameplay write."""

    def __init__(self) -> None:
        super().__init__(job_config_id=7)
        self.executed = False

    async def execute(self, _db) -> None:
        self.executed = True


@pytest.mark.asyncio
async def test_base_job_cancels_a_maintained_regular_writer_before_execute() -> None:
    """The persisted guard is checked after configuration refresh and before writes."""
    job = _MaintenanceBlockedJob()
    job.is_already_running = AsyncMock(return_value=False)
    job.log_completion = AsyncMock()
    job.check_control_state = AsyncMock()

    async def fake_log_start(_db) -> None:
        job.job_execution = SimpleNamespace(id=13)

    async def fake_refresh(_db) -> None:
        job.job_config = SimpleNamespace(
            name="match fetcher",
            job_type=JobType.MATCH_FETCHER,
            config_json={RIOT_MAINTENANCE_MODE_KEY: True},
        )

    @asynccontextmanager
    async def fake_session():
        yield object()

    job.log_start = fake_log_start
    job._refresh_config = fake_refresh
    job._db_session = fake_session

    await job.run()

    assert not job.executed
    job.check_control_state.assert_not_awaited()
    assert job.execution_log["riot_maintenance_blocked"] is True
    assert job.execution_log["stop_reason"] == "riot_maintenance"
    assert job.log_completion.await_args.kwargs["status"] == JobStatus.CANCELLED
