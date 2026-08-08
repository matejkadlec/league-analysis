"""Background-job configuration and error-boundary tests."""

from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.core.riot_api.errors import (
    AuthenticationError,
    ForbiddenError,
    RateLimitError,
)
from app.features.jobs.base import BaseJob
from app.features.jobs.error_handling import (
    RateLimitSignal,
    handle_riot_api_errors,
    is_riot_api_key_error,
)
from app.features.jobs.implementations.match_fetcher import MatchFetcherJob
from app.features.jobs.implementations.player_updater import PlayerUpdaterJob
from app.features.jobs.maintenance import (
    RIOT_MAINTENANCE_MODE_KEY,
    RIOT_WRITER_TABLES,
    RiotWriterMaintenanceConfigurationError,
    is_riot_writer_maintenance_active,
    preserve_riot_writer_maintenance_mode,
    riot_writer_maintenance_is_active,
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


@pytest.mark.parametrize(
    "error",
    [
        AuthenticationError("expired", status_code=401),
        ForbiddenError("expired", status_code=403),
    ],
)
def test_riot_key_rejections_use_typed_status_classification(error: Exception) -> None:
    assert is_riot_api_key_error(error)
    assert not is_riot_api_key_error(RuntimeError("unrelated 401 text"))


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

    assert riot_writer_maintenance_is_active(
        {
            JobType.MATCH_FETCHER: config,
            JobType.PLAYER_UPDATER: SimpleNamespace(
                job_type=JobType.PLAYER_UPDATER,
                config_json={RIOT_MAINTENANCE_MODE_KEY: False},
            ),
        }
    )
    assert not riot_writer_maintenance_is_active(
        {
            JobType.MATCH_FETCHER: SimpleNamespace(
                job_type=JobType.MATCH_FETCHER,
                config_json={RIOT_MAINTENANCE_MODE_KEY: False},
            )
        }
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
        {RIOT_MAINTENANCE_MODE_KEY: True},
    ) == {RIOT_MAINTENANCE_MODE_KEY: True}
    assert preserve_riot_writer_maintenance_mode(
        JobType.MATCH_FETCHER,
        {},
        {"enabled_queue_ids": []},
    ) == {"enabled_queue_ids": []}

    with pytest.raises(RiotWriterMaintenanceConfigurationError):
        preserve_riot_writer_maintenance_mode(
            JobType.MATCH_FETCHER,
            {"enabled_queue_ids": [420]},
            {
                "enabled_queue_ids": [420],
                RIOT_MAINTENANCE_MODE_KEY: True,
            },
        )


@pytest.mark.asyncio
async def test_job_configuration_update_locks_cleanup_tables_before_its_row(
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

    assert str(session.statements[0]) == (
        f"LOCK TABLE {', '.join(RIOT_WRITER_TABLES)} IN ROW EXCLUSIVE MODE"
    )
    assert getattr(session.statements[1], "_for_update_arg") is not None
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


async def _run_job_with_recorded_error(
    job: BaseJob,
    error: Exception,
    *,
    is_api_key_error: bool,
) -> dict[str, object]:
    """Run a regular writer through BaseJob's real completion decision."""
    job.is_already_running = AsyncMock(return_value=False)  # type: ignore[method-assign]
    job.log_completion = AsyncMock()  # type: ignore[method-assign]
    job.check_control_state = AsyncMock()  # type: ignore[method-assign]

    async def fake_log_start(_db: object) -> None:
        job.job_execution = SimpleNamespace(id=13)

    async def fake_refresh(_db: object) -> None:
        job.job_config = SimpleNamespace(
            name="writer job",
            job_type=JobType.MATCH_FETCHER,
            config_json={},
        )

    async def fake_execute(_db: object) -> None:
        job.record_error(
            error,
            operation="player synchronization",
            context={"puuid": "sanitized-puuid"},
            is_api_key_error=is_api_key_error,
        )

    @asynccontextmanager
    async def fake_session():
        yield object()

    job.log_start = fake_log_start  # type: ignore[method-assign]
    job._refresh_config = fake_refresh  # type: ignore[method-assign]
    job.execute = fake_execute  # type: ignore[method-assign]
    job._db_session = fake_session  # type: ignore[method-assign]

    await job.run()
    return job.log_completion.await_args.kwargs  # type: ignore[union-attr]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("job_class", "triggered_by"),
    [
        (MatchFetcherJob, "system"),
        (MatchFetcherJob, "user"),
        (PlayerUpdaterJob, "system"),
        (PlayerUpdaterJob, "user"),
    ],
)
async def test_regular_writers_finish_successfully_with_recoverable_warnings(
    job_class: type[BaseJob],
    triggered_by: str,
) -> None:
    kwargs = await _run_job_with_recorded_error(
        job_class(7, triggered_by=triggered_by),
        RuntimeError("recoverable provider failure"),
        is_api_key_error=False,
    )

    assert kwargs["success"] is True
    assert kwargs.get("error_message") is None
    assert job_class.recorded_errors_are_fatal is False


@pytest.mark.asyncio
async def test_successful_writer_keeps_warning_summary_out_of_error_message() -> None:
    job = MatchFetcherJob(7)
    kwargs = await _run_job_with_recorded_error(
        job,
        RuntimeError("recoverable provider failure"),
        is_api_key_error=False,
    )

    assert kwargs.get("error_message") is None
    assert job.execution_log["completed_with_warnings"] is True
    assert job.execution_log["warning_count"] == 1
    assert job.execution_log["warning_summary"] == (
        "Job completed with 1 warning(s); first warning: "
        "player synchronization (RuntimeError)"
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("job_class", [MatchFetcherJob, PlayerUpdaterJob])
async def test_regular_writers_fail_when_riot_rejects_the_api_key(
    job_class: type[BaseJob],
) -> None:
    kwargs = await _run_job_with_recorded_error(
        job_class(7),
        ForbiddenError("expired", status_code=403),
        is_api_key_error=True,
    )

    assert kwargs["success"] is False
    assert kwargs["error_message"] == ("API key error: Invalid or expired Riot API key")
