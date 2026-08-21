"""Background-job configuration and error-boundary tests."""

from collections.abc import AsyncGenerator, Callable, Mapping
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import cast, override
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import Select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.riot_api.client import APICallRecord
from app.core.riot_api.constants import PRODUCT_SUPPORTED_QUEUE_IDS
from app.core.riot_api.errors import (
    AuthenticationError,
    ForbiddenError,
)
from app.features.jobs import scheduler as scheduler_module
from app.features.jobs.base import BaseJob, _format_api_calls_for_storage
from app.features.jobs.error_handling import (
    is_riot_api_key_error,
)
from app.features.jobs.implementations.match_fetcher import MatchFetcherJob
from app.features.jobs.implementations.player_updater import PlayerUpdaterJob
from app.features.jobs.maintenance import (
    RIOT_MAINTENANCE_MODE_KEY,
    RIOT_WRITER_TABLES,
    RiotWriterMaintenanceActiveError,
    RiotWriterMaintenanceConfigurationError,
    ensure_riot_writer_maintenance_is_inactive,
    is_riot_writer_maintenance_active,
    preserve_riot_writer_maintenance_mode,
    riot_writer_maintenance_is_active,
)
from app.features.jobs.models import (
    ExecutionType,
    JobConfiguration,
    JobExecution,
    JobStatus,
    JobType,
)
from app.features.jobs.queue_config import normalize_match_fetcher_config
from app.features.jobs.schemas import (
    JobConfigurationResponse,
    JobConfigurationUpdate,
    JobExecutionDetailedLogs,
)
from app.features.jobs.service import JobService


def _job_configuration_double(**attributes: object) -> JobConfiguration:
    """Return a structural stand-in for a `job_configurations` row.

    Constructing the mapped class would configure SQLAlchemy's entire mapper
    registry, and this file imports only the jobs models, so a real instance
    fails to initialize. The double carries exactly the columns the code under
    test reads.
    """
    return cast(JobConfiguration, SimpleNamespace(**attributes))


def _job_execution_double(**attributes: object) -> JobExecution:
    """Return a structural stand-in for a `job_executions` row, as above."""
    return cast(JobExecution, SimpleNamespace(**attributes))


def _job_service_double(job_model: SimpleNamespace) -> JobService:
    """A real JobService over a double session, looking up `job_model`."""
    service = JobService(
        cast(AsyncSession, SimpleNamespace(commit=AsyncMock(), refresh=AsyncMock()))
    )
    service.get_job_configuration_model = AsyncMock(return_value=job_model)
    return service


@pytest.mark.parametrize("paused", [True, False])
async def test_test_run_pause_and_resume_flip_the_runs_own_flag(
    monkeypatch: pytest.MonkeyPatch,
    paused: bool,
) -> None:
    """Pause is per run: the test-run routes flip only the negated key's flag."""
    from app.features.jobs import control as control_module
    from app.features.jobs import router as jobs_router

    monkeypatch.setattr(control_module, "_runtime_controls", {})
    control_module.register_runtime_control(-7, None)
    control_module.set_runtime_job_paused(-7, not paused)
    control_module.register_runtime_control(7, None)

    job_model = SimpleNamespace(id=7, name="Match Fetcher")
    job_service = _job_service_double(job_model)

    endpoint = jobs_router.pause_test_run if paused else jobs_router.resume_test_run
    response = await endpoint(7, job_service)

    assert response.success is True
    assert response.is_paused is paused
    assert control_module.get_runtime_control_snapshot(-7)["is_paused"] is paused
    # The concurrent scheduled run's own flag is untouched — the flags can
    # no longer interfere, which is the point of moving pause off the row.
    assert control_module.get_runtime_control_snapshot(7)["is_paused"] is False
    assert ("paused" if paused else "resumed") in response.message
    # Pause is runtime state now: nothing to persist.
    cast(AsyncMock, job_service.db.commit).assert_not_awaited()


async def test_test_run_pause_without_an_active_run_changes_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No active test run: report failure and touch no state."""
    from app.features.jobs import control as control_module
    from app.features.jobs import router as jobs_router

    monkeypatch.setattr(control_module, "_runtime_controls", {})

    job_model = SimpleNamespace(id=7, name="Match Fetcher")
    job_service = _job_service_double(job_model)

    response = await jobs_router.pause_test_run(7, job_service)

    assert response.success is False
    assert response.is_paused is False
    cast(AsyncMock, job_service.db.commit).assert_not_awaited()


async def test_stopping_one_run_leaves_the_other_runs_pause_alone(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Stopping the test run must not resume a paused concurrent scheduled run.

    This held in neither direction while the flag was a shared DB column:
    each stop had to guess which run owned it. Per-key flags make the
    question disappear.
    """
    from app.features.jobs import control as control_module
    from app.features.jobs import router as jobs_router

    monkeypatch.setattr(control_module, "_runtime_controls", {})
    control_module.register_runtime_control(7, None)
    control_module.set_runtime_job_paused(7, True)
    control_module.register_runtime_control(-7, None)
    control_module.set_runtime_job_paused(-7, True)

    job_model = SimpleNamespace(id=7, name="Match Fetcher")
    job_service = _job_service_double(job_model)

    response = await jobs_router.stop_test_run(7, job_service, force=False)

    assert response.success is True
    assert "test run of" in response.message
    # Stopping clears the run's own pause: a stopping run must not report
    # paused-and-stopping, which the card would render as "Resume".
    assert response.is_paused is False
    test_state = control_module.get_runtime_control_snapshot(-7)
    assert test_state["stop_requested"] is True
    assert test_state["is_paused"] is False
    # The scheduled run stays paused, and was not asked to stop.
    scheduled = control_module.get_runtime_control_snapshot(7)
    assert scheduled["is_paused"] is True
    assert scheduled["stop_requested"] is False
    cast(AsyncMock, job_service.db.commit).assert_not_awaited()


async def test_status_overview_reports_the_earliest_scheduled_run(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The overview surfaces the soonest next_run_time across scheduled jobs."""
    from app.features.jobs import router as jobs_router

    soon = datetime.now(UTC) + timedelta(minutes=5)
    later = soon + timedelta(hours=1)

    class SchedulerDouble:
        running = True

        def get_jobs(self) -> list[SimpleNamespace]:
            return [
                SimpleNamespace(next_run_time=later),
                SimpleNamespace(next_run_time=soon),
                SimpleNamespace(next_run_time=None),
            ]

    monkeypatch.setattr(scheduler_module, "_scheduler", SchedulerDouble())
    job_service = SimpleNamespace(
        get_active_job_count=AsyncMock(return_value=2),
        get_running_execution_count=AsyncMock(return_value=0),
        get_latest_execution=AsyncMock(return_value=None),
    )

    response = await jobs_router.get_job_system_status(
        job_service=cast(JobService, job_service)
    )

    assert response.next_run_time == soon
    assert response.scheduler_running is True


async def test_scheduler_shutdown_does_not_drain_running_jobs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Deploy shutdown must not wait for an ordinary long-running job."""

    class SchedulerDouble:
        def __init__(self) -> None:
            self.wait_values: list[bool] = []

        def shutdown(self, *, wait: bool) -> None:
            self.wait_values.append(wait)

    scheduler = SchedulerDouble()
    monkeypatch.setattr(scheduler_module, "_scheduler", scheduler)

    await scheduler_module.shutdown_scheduler()

    assert scheduler.wait_values == [False]
    assert scheduler_module.get_scheduler() is None


async def test_overdue_startup_job_is_queued_without_awaiting_execution(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A Riot catch-up must not hold FastAPI startup or duplicate dispatch."""

    job_config = SimpleNamespace(
        id=7,
        name="Match Fetcher",
        job_type=JobType.MATCH_FETCHER,
        config_json={"interval_seconds": 900},
        schedule="interval:900",
    )
    last_execution = SimpleNamespace(
        started_at=datetime.now(UTC) - timedelta(minutes=16)
    )

    class ResultDouble:
        def __init__(self, value: object) -> None:
            self.value = value

        def scalars(self) -> ResultDouble:
            return self

        def all(self) -> object:
            return self.value

        def scalar_one_or_none(self) -> object:
            return self.value

    class SessionDouble:
        def __init__(self, result: object) -> None:
            self.result = result

        async def execute(self, _statement: object) -> ResultDouble:
            return ResultDouble(self.result)

    sessions = iter([SessionDouble([job_config]), SessionDouble(last_execution)])

    @asynccontextmanager
    async def get_session() -> AsyncGenerator[SessionDouble]:
        yield next(sessions)

    constructed: list[tuple[int, str]] = []

    class JobDouble:
        def __init__(self, job_config_id: int, triggered_by: str) -> None:
            constructed.append((job_config_id, triggered_by))

        async def run(self) -> None:  # pragma: no cover - must not run here
            raise AssertionError("startup awaited provider work")

    scheduled: list[dict[str, object]] = []

    class SchedulerDouble:
        def add_job(self, func: Callable[..., object], **kwargs: object) -> None:
            scheduled.append({"func": func, **kwargs})

    monkeypatch.setattr(scheduler_module.db_manager, "get_session", get_session)
    monkeypatch.setattr(
        scheduler_module,
        "_get_job_registry",
        lambda: {JobType.MATCH_FETCHER: JobDouble},
    )
    monkeypatch.setattr(scheduler_module, "_scheduler", SchedulerDouble())

    await scheduler_module._check_and_run_overdue_jobs()

    assert constructed == [(7, "system")]
    assert len(scheduled) == 1
    assert scheduled[0] == {
        "func": scheduled[0]["func"],
        "trigger": "date",
        "run_date": scheduled[0]["run_date"],
        "id": "startup_overdue_job_7",
        "name": "Match Fetcher startup catch-up",
        "replace_existing": True,
    }


def test_api_call_storage_groups_to_one_entry_per_endpoint() -> None:
    # The frontend keys its API-call rows by the endpoint alone
    # (job-execution-api-calls.tsx), so this grouping is a cross-package
    # contract: regroup by anything finer — region, batch, time window —
    # and those React keys collide, freezing the first row's numbers on
    # every later row.
    calls = [
        APICallRecord(
            endpoint="/lol/match/v5/matches/{matchId}",
            region="europe",
            params={"matchId": "EUN1_1"},
            timestamp="2026-01-01T00:00:00Z",
        ),
        APICallRecord(
            endpoint="/lol/match/v5/matches/{matchId}",
            region="americas",
            params={"matchId": "NA1_2"},
            timestamp="2026-01-01T00:00:01Z",
        ),
        APICallRecord(
            endpoint="/lol/summoner/v4/summoners/by-puuid/{puuid}",
            region="eun1",
            params={"puuid": "p1"},
            timestamp="2026-01-01T00:00:02Z",
        ),
    ]

    stored = _format_api_calls_for_storage(calls)

    endpoints = [entry["endpoint"] for entry in stored]
    assert len(endpoints) == len(set(endpoints)) == 2
    # A cross-region group names every region it spanned, in call order —
    # the fixture's match endpoint deliberately spans two regions.
    match_entry = next(e for e in stored if e["endpoint"].startswith("/lol/match"))
    assert match_entry["region"] == "europe, americas"


def test_match_fetcher_uses_every_canonical_queue_and_strips_legacy_config() -> None:
    assert list(PRODUCT_SUPPORTED_QUEUE_IDS) == [420, 440, 480, 400, 450, 2400]
    assert normalize_match_fetcher_config(None) == {}
    assert normalize_match_fetcher_config(
        {"enabled_queue_ids": [], "interval_seconds": 3600}
    ) == {"interval_seconds": 3600}


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


def test_riot_maintenance_mode_blocks_only_regular_writer_jobs() -> None:
    """Cleanup cannot block non-writing tests or unrelated future job types."""
    config = _job_configuration_double(
        job_type=JobType.MATCH_FETCHER,
        config_json={RIOT_MAINTENANCE_MODE_KEY: True},
    )

    assert is_riot_writer_maintenance_active(config, ExecutionType.REGULAR)
    assert not is_riot_writer_maintenance_active(config, ExecutionType.TEST)
    assert not is_riot_writer_maintenance_active(
        _job_configuration_double(
            job_type=JobType.PLAYER_UPDATER,
            config_json={RIOT_MAINTENANCE_MODE_KEY: False},
        ),
        ExecutionType.REGULAR,
    )

    assert riot_writer_maintenance_is_active(
        {
            JobType.MATCH_FETCHER: config,
            JobType.PLAYER_UPDATER: _job_configuration_double(
                job_type=JobType.PLAYER_UPDATER,
                config_json={RIOT_MAINTENANCE_MODE_KEY: False},
            ),
        }
    )
    assert not riot_writer_maintenance_is_active(
        {
            JobType.MATCH_FETCHER: _job_configuration_double(
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


async def test_job_configuration_update_locks_cleanup_tables_before_its_row(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A stale queue field cannot overwrite cleanup's interlock or active state."""
    job = _job_configuration_double(
        id=7,
        job_type=JobType.MATCH_FETCHER,
        config_json={RIOT_MAINTENANCE_MODE_KEY: True, "enabled_queue_ids": [420]},
        name="match fetcher",
        is_active=True,
        is_paused=False,
    )

    class Result:
        def scalar_one_or_none(self) -> JobConfiguration:
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

    def passthrough_response(
        configuration: JobConfiguration,
    ) -> JobConfigurationResponse:
        """Assert against the row the service updated, not its serialized form."""
        return cast(JobConfigurationResponse, configuration)

    monkeypatch.setattr(
        JobService, "_to_job_response", staticmethod(passthrough_response)
    )
    session = Session()
    service = JobService(cast(AsyncSession, session))

    updated = await service.update_job_configuration(
        7,
        JobConfigurationUpdate(config_json={"enabled_queue_ids": [440]}),
    )

    assert str(session.statements[0]) == (
        f"LOCK TABLE {', '.join(RIOT_WRITER_TABLES)} IN ROW EXCLUSIVE MODE"
    )
    row_statement = session.statements[1]
    assert isinstance(row_statement, Select)
    assert row_statement._for_update_arg is not None
    assert updated is not None
    assert updated.config_json == {
        RIOT_MAINTENANCE_MODE_KEY: True,
    }
    assert updated.is_active is True


class _MaintenanceBlockedJob(BaseJob):
    """Small BaseJob double that records an unexpected gameplay write."""

    def __init__(self) -> None:
        super().__init__(job_config_id=7)
        self.executed = False

    @override
    async def execute(self, db: AsyncSession) -> None:
        self.executed = True


async def test_base_job_cancels_a_maintained_regular_writer_before_execute() -> None:
    """The persisted guard is checked after configuration refresh and before writes."""
    job = _MaintenanceBlockedJob()
    job.is_already_running = AsyncMock(return_value=False)
    job.log_completion = AsyncMock()
    job.check_control_state = AsyncMock()

    async def fake_log_start(db: AsyncSession) -> None:
        job.job_execution = _job_execution_double(id=13)

    async def fake_refresh(db: AsyncSession) -> None:
        job.job_config = _job_configuration_double(
            name="match fetcher",
            job_type=JobType.MATCH_FETCHER,
            config_json={RIOT_MAINTENANCE_MODE_KEY: True},
        )

    @asynccontextmanager
    async def fake_session() -> AsyncGenerator[AsyncSession]:
        # Every method that would touch the session is stubbed above, so the
        # run never reaches a real query.
        yield cast(AsyncSession, object())

    job.log_start = fake_log_start
    job._refresh_config = fake_refresh
    job._db_session = fake_session

    await job.run()

    assert not job.executed
    job.check_control_state.assert_not_awaited()
    assert job.execution_log["riot_maintenance_blocked"] is True
    assert job.execution_log["stop_reason"] == "riot_maintenance"
    completion_call = job.log_completion.await_args
    assert completion_call is not None
    assert completion_call.kwargs["status"] == JobStatus.CANCELLED


async def _run_job_with_recorded_error(
    job: BaseJob,
    error: Exception,
    *,
    is_api_key_error: bool,
) -> Mapping[str, object]:
    """Run a regular writer through BaseJob's real completion decision."""
    job.is_already_running = AsyncMock(return_value=False)
    job.log_completion = AsyncMock()
    job.check_control_state = AsyncMock()

    async def fake_log_start(db: AsyncSession) -> None:
        job.job_execution = _job_execution_double(id=13)

    async def fake_refresh(db: AsyncSession) -> None:
        job.job_config = _job_configuration_double(
            name="writer job",
            job_type=JobType.MATCH_FETCHER,
            config_json={},
        )

    async def fake_execute(db: AsyncSession) -> None:
        job.record_error(
            error,
            operation="player synchronization",
            context={"puuid": "sanitized-puuid"},
            is_api_key_error=is_api_key_error,
        )

    @asynccontextmanager
    async def fake_session() -> AsyncGenerator[AsyncSession]:
        # Every method that would touch the session is stubbed above, so the
        # run never reaches a real query.
        yield cast(AsyncSession, object())

    job.log_start = fake_log_start
    job._refresh_config = fake_refresh
    job.execute = fake_execute
    job._db_session = fake_session

    await job.run()
    completion_call = job.log_completion.await_args
    assert completion_call is not None
    return completion_call.kwargs


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


class _WriterInterlockSession:
    """Session double for the maintenance interlock read path.

    Records every statement so the test can hold the module to its own
    docstring: locks first, in cleanup's order, then a locked read.
    """

    def __init__(self, maintenance_mode: bool) -> None:
        self.statements: list[object] = []
        self._maintenance_mode = maintenance_mode

    async def execute(self, statement: object) -> object:
        self.statements.append(statement)
        configuration = _job_configuration_double(
            job_type=JobType.MATCH_FETCHER,
            config_json={RIOT_MAINTENANCE_MODE_KEY: self._maintenance_mode},
        )

        class Scalars:
            def all(self) -> list[JobConfiguration]:
                return [configuration]

        return SimpleNamespace(scalars=lambda: Scalars())


async def test_writer_refusal_locks_first_and_raises_on_an_active_interlock() -> None:
    # The refusal exists to stop a Riot writer while cleanup owns the data
    # tables. It only works if the lock comes *before* the read — read first
    # and the answer can be stale by the time the writer proceeds, which is
    # the lock inversion the table order in this module exists to prevent.
    # Compiling the Select below configures every mapper, so the whole
    # registry must be imported first (the same trap as test_transformers).
    from app.model_registry import import_all_models

    import_all_models()

    session = _WriterInterlockSession(maintenance_mode=True)

    with pytest.raises(RiotWriterMaintenanceActiveError):
        await ensure_riot_writer_maintenance_is_inactive(cast(AsyncSession, session))

    assert str(session.statements[0]) == (
        f"LOCK TABLE {', '.join(RIOT_WRITER_TABLES)} IN ROW EXCLUSIVE MODE"
    )
    configuration_read = session.statements[1]
    assert isinstance(configuration_read, Select)
    # A read without FOR UPDATE lets cleanup flip the interlock between this
    # check and the write it is guarding.
    assert configuration_read._for_update_arg is not None
    assert "job_type IN" in str(cast(object, configuration_read))


async def test_writer_proceeds_when_no_interlock_is_set() -> None:
    session = _WriterInterlockSession(maintenance_mode=False)

    await ensure_riot_writer_maintenance_is_inactive(cast(AsyncSession, session))

    assert len(session.statements) == 2


def test_detailed_logs_accepts_every_shape_production_stores() -> None:
    """The three shapes measured in `jobs.job_executions` on 2026-08-21.

    2,620 rows hold an object: 1,806 `{api_calls, logs}`, 811 `{logs}`, and 3
    a legacy `{message}` written before this contract existed. Naming the
    shape is only safe while that last one still parses -- a strict model
    would 500 the executions dialog on those three rows instead.
    """
    grouped = JobExecutionDetailedLogs.model_validate(
        {
            "logs": [{"event": "started"}],
            "api_calls": [
                {
                    "endpoint": "/lol/match/v5/matches/{matchId}",
                    "region": "europe",
                    "count": 2,
                    "first_timestamp": "2026-08-21T00:00:00Z",
                    "last_timestamp": "2026-08-21T00:00:09Z",
                    "param_key": "matchId",
                    "first_param": "EUN1_1",
                    "last_param": "EUN1_2",
                }
            ],
        }
    )
    assert grouped.api_calls[0].count == 2
    assert grouped.api_calls[0].params is None

    single = JobExecutionDetailedLogs.model_validate(
        {
            "logs": [],
            "api_calls": [
                {
                    "endpoint": "/lol/summoner/v4/summoners/by-puuid/{puuid}",
                    "region": "eun1",
                    "count": 1,
                    "first_timestamp": "2026-08-21T00:00:00Z",
                    "last_timestamp": "2026-08-21T00:00:00Z",
                    "params": {"puuid": "abc"},
                }
            ],
        }
    )
    assert single.api_calls[0].params == {"puuid": "abc"}
    assert single.api_calls[0].param_key is None

    # A legacy row parses to two empty lists, never to `None`: the response
    # never puts a `null` where the frontend expects an array.
    legacy = JobExecutionDetailedLogs.model_validate({"message": "no logs captured"})
    assert legacy.logs == []
    assert legacy.api_calls == []
