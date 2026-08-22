"""Regressions for stale-PUUID classification and job completion bookkeeping."""

from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any, NoReturn, Self, cast, override
from unittest.mock import AsyncMock, Mock

import pytest
from sqlalchemy import Table, Update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import Base
from app.core.riot_api.client import JSONValue, RiotAPIClient
from app.core.riot_api.constants import Platform
from app.core.riot_api.errors import BadRequestError, PuuidDecryptionError
from app.features.jobs import player_sync as player_sync_module
from app.features.jobs.base import BaseJob
from app.features.jobs.error_handling import is_riot_puuid_binding_error
from app.features.jobs.models import (
    ExecutionType,
    JobConfiguration,
    JobExecution,
    JobStatus,
)
from app.features.jobs.player_sync import _failure_from_job, _finish_sync
from app.features.players import service as player_service_module
from app.features.players.models import Player
from app.features.players.service import PlayerService

# The account these tests act as. Every stored run belongs to one, so a service
# cannot be built without saying which.
_USER_ID = 7

FRESH_PUUID = "f" * 78


class _Job(BaseJob):
    """Minimal concrete job used to exercise BaseJob bookkeeping."""

    @override
    async def execute(
        self, db: AsyncSession
    ) -> None:  # pragma: no cover - never invoked
        return None


def _client() -> RiotAPIClient:
    return RiotAPIClient(api_key="test-key")


def _job_double(**attributes: object) -> BaseJob:
    """Present a duck-typed writer result as the `BaseJob` the API declares.

    `_failure_from_job` is documented to read only the writer's cached scalars
    and its two classification predicates, and several tests below exist to
    prove it touches nothing else. A real `BaseJob` carries a live
    `JobExecution`, so it would hide exactly the regression under test; the
    cast records that only the read attributes are populated on purpose.
    """
    return cast(BaseJob, SimpleNamespace(**attributes))


def test_decrypt_400_becomes_puuid_decryption_error() -> None:
    """Riot's decrypt rejection must be distinguishable from any other 400."""
    with pytest.raises(PuuidDecryptionError):
        _client()._raise_client_error_if_needed(
            400, "Bad Request - Exception decrypting SOME_PUUID"
        )


def test_other_400_stays_a_plain_bad_request() -> None:
    """An ordinary parameter rejection must not be treated as a stale PUUID."""
    with pytest.raises(BadRequestError) as excinfo:
        _client()._raise_client_error_if_needed(400, "Bad Request - Invalid queue")

    assert not isinstance(excinfo.value, PuuidDecryptionError)


def test_decrypt_error_carries_no_puuid_payload() -> None:
    """The exception text must not repeat the provider payload."""
    with pytest.raises(PuuidDecryptionError) as excinfo:
        _client()._raise_client_error_if_needed(
            400, "Bad Request - Exception decrypting SECRET_LOOKING_PUUID"
        )

    assert "SECRET_LOOKING_PUUID" not in str(excinfo.value)


def test_status_message_extraction_survives_a_non_json_body() -> None:
    """A malformed error body must not mask the original failure."""

    class _Response:
        @staticmethod
        def json() -> NoReturn:
            raise ValueError("not json")

    assert RiotAPIClient._extract_riot_status_message(_Response()) is None


def test_status_message_extraction_reads_riot_shape() -> None:
    """Riot nests the human-readable reason under `status.message`."""

    class _Response:
        @staticmethod
        def json() -> JSONValue:
            return {"status": {"message": "Bad Request - Exception decrypting X"}}

    assert (
        RiotAPIClient._extract_riot_status_message(_Response())
        == "Bad Request - Exception decrypting X"
    )


def test_is_riot_puuid_binding_error_discriminates() -> None:
    """Only the dedicated decrypt error counts as a stale-PUUID signal."""
    assert is_riot_puuid_binding_error(PuuidDecryptionError("stale", status_code=400))
    assert not is_riot_puuid_binding_error(BadRequestError("nope", status_code=400))


def test_record_error_flags_a_binding_failure() -> None:
    """A recorded decrypt error must remain visible to the sync orchestrator."""
    job = _Job(job_config_id=1)
    assert not job.has_puuid_binding_error()

    job.record_error(
        PuuidDecryptionError("stale", status_code=400),
        operation="player league update",
    )

    assert job.has_puuid_binding_error()
    assert not job.has_api_key_error()


def test_get_job_logs_never_touches_the_orm_instance() -> None:
    """A rollback expires ORM attributes, so completion must use the cached id."""

    class _Exploding:
        @property
        def id(self):
            raise AssertionError("expired ORM attribute was read")

    job = _Job(job_config_id=1)
    job.job_execution = cast(JobExecution, _Exploding())
    job.job_execution_id = 4242

    assert job._get_job_logs() == []


def test_failure_from_job_reports_a_stale_player_id() -> None:
    """The player card must explain a stale PUUID instead of a generic failure."""
    job = _job_double(
        job_execution_id=11,
        job_execution_status=JobStatus.SUCCESS,
        skipped_as_already_running=False,
        has_api_key_error=lambda: False,
        has_puuid_binding_error=lambda: True,
    )

    status, code, message = _failure_from_job(job)

    assert status == "failed"
    assert code == "PLAYER_ID_STALE"
    # Discovery does not repair a stale row, so the message must not promise it.
    assert "re-added" in message
    assert "Search for the player again" not in message


def test_failure_from_job_keeps_the_key_error_precedence() -> None:
    """A rejected API key stays the more actionable diagnosis."""
    job = _job_double(
        job_execution_id=12,
        job_execution_status=JobStatus.FAILED,
        skipped_as_already_running=False,
        has_api_key_error=lambda: True,
        has_puuid_binding_error=lambda: True,
    )

    _, code, _ = _failure_from_job(job)

    assert code == "RIOT_API_KEY_INVALID"


def test_generic_failure_is_unchanged() -> None:
    """Unclassified failures keep their existing contract."""
    job = _job_double(
        job_execution_id=13,
        job_execution_status=JobStatus.FAILED,
        skipped_as_already_running=False,
        has_api_key_error=lambda: False,
        has_puuid_binding_error=lambda: False,
    )

    _, code, _ = _failure_from_job(job)

    assert code == "SYNC_FAILED"


def test_test_runs_keep_a_separate_runtime_key() -> None:
    """Guard the unchanged runtime-key contract touched by this module."""
    regular = _Job(job_config_id=7)
    test_run = _Job(job_config_id=7, execution_type=ExecutionType.TEST)

    assert regular.runtime_key == 7
    assert test_run.runtime_key == -7


def test_failure_from_job_never_touches_the_execution_instance() -> None:
    """The job session is already closed, so only cached scalars are safe."""

    class _Exploding:
        @property
        def status(self):
            raise AssertionError("expired ORM attribute was read")

    job = _job_double(
        job_execution=_Exploding(),
        job_execution_id=99,
        job_execution_status=JobStatus.SUCCESS,
        skipped_as_already_running=False,
        has_api_key_error=lambda: False,
        has_puuid_binding_error=lambda: True,
    )

    _, code, _ = _failure_from_job(job)

    assert code == "PLAYER_ID_STALE"


def test_a_skipped_writer_reports_a_busy_writer() -> None:
    """A writer the scheduler skipped keeps the existing busy contract."""
    job = _job_double(
        job_execution_id=None,
        job_execution_status=None,
        skipped_as_already_running=True,
        has_api_key_error=lambda: False,
        has_puuid_binding_error=lambda: False,
    )

    _, code, _ = _failure_from_job(job)

    assert code == "SYNC_BUSY"


def test_a_failed_start_is_not_reported_as_a_busy_writer() -> None:
    """`run()` swallows a `log_start` failure and returns with no execution id.

    Classifying that database failure as a competing update would tell the user
    to wait for a run that never exists.
    """
    job = _job_double(
        job_execution_id=None,
        job_execution_status=None,
        skipped_as_already_running=False,
        has_api_key_error=lambda: False,
        has_puuid_binding_error=lambda: False,
    )

    _, code, _ = _failure_from_job(job)

    assert code == "SYNC_FAILED"


class _FailingSession:
    """Session whose every write fails, as a lost connection would."""

    def __init__(self) -> None:
        self.rollbacks = 0

    async def execute(self, *args: object, **kwargs: object) -> NoReturn:
        raise RuntimeError("connection lost")

    async def commit(self) -> NoReturn:
        raise RuntimeError("connection lost")

    async def rollback(self) -> None:
        self.rollbacks += 1


async def test_completion_flag_requires_a_successful_write() -> None:
    """A swallowed completion-write failure must not disable the run guard."""
    job = _Job(job_config_id=1)
    job.job_execution_id = 7
    job.job_execution = cast(JobExecution, SimpleNamespace())
    job.job_config = cast(JobConfiguration, SimpleNamespace())
    job.job_config_name = "test job"
    job.job_config_type_value = "match_fetcher"
    db = _FailingSession()

    await job.log_completion(cast(AsyncSession, db), success=True)

    assert job._completion_logged is False
    # A status the database never accepted must not reach the classifier.
    assert job.job_execution_status is None


async def test_a_failed_completion_write_does_not_publish_its_status() -> None:
    """The fallback persists FAILED, so a cached CANCELLED would contradict it."""
    job = _Job(job_config_id=1)
    job.job_execution_id = 8
    job.job_execution = cast(JobExecution, SimpleNamespace())
    job.job_config = cast(JobConfiguration, SimpleNamespace())
    job.job_config_name = "test job"
    job.job_config_type_value = "match_fetcher"
    db = _FailingSession()

    await job.log_completion(
        cast(AsyncSession, db),
        success=True,
        status=JobStatus.CANCELLED,
    )

    assert job.job_execution_status is not JobStatus.CANCELLED


class _RecordingSession:
    """Session that hands back one row and records whether a write happened."""

    def __init__(self, run: object) -> None:
        self._run = run
        self.committed = False
        self.locked = False

    async def get(
        self, _model: object, _identity: object, with_for_update: bool = False
    ) -> object:
        self.locked = with_for_update
        return self._run

    async def commit(self) -> None:
        self.committed = True

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(self, *_exc: object) -> None:
        return None


async def test_a_cancelled_sync_run_is_never_reopened(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An operator stop or startup recovery may cancel a run mid-flight.

    The orchestrator may still be running, and an unguarded write would set that
    terminal row back to `running` and could then collide with a replacement run
    on the same PUUID.
    """
    run = SimpleNamespace(status="cancelled", started_at=None, completed_at=None)
    session = _RecordingSession(run)
    monkeypatch.setattr(player_sync_module.db_manager, "get_session", lambda: session)

    await _finish_sync(1, status="running")

    assert run.status == "cancelled"
    assert session.committed is False
    assert session.locked is True, "the row must be locked against a concurrent write"


async def test_an_active_sync_run_still_advances(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The guard must not block the ordinary lifecycle."""
    run = SimpleNamespace(
        status="pending",
        started_at=None,
        completed_at=None,
        error_code=None,
        error_message=None,
        updated_at=None,
    )
    session = _RecordingSession(run)
    monkeypatch.setattr(player_sync_module.db_manager, "get_session", lambda: session)

    await _finish_sync(1, status="running")

    assert run.status == "running"
    assert session.committed is True


class _NoMergeSession:
    """Session that fails the test if discovery reaches for another player row.

    Discovery may look the resolved PUUID up by primary key and insert or update
    that one row. Any statement execution, bulk query, or delete would mean it
    went looking for rows sharing the Riot ID, which is exactly the merge this
    regression forbids.
    """

    def __init__(self) -> None:
        self.added: list[Player] = []

    async def get(self, _model: object, identity: object, **_kwargs: object) -> None:
        assert identity == FRESH_PUUID, "discovery must only load the resolved PUUID"
        return None

    def add(self, instance: Player) -> None:
        self.added.append(instance)

    async def commit(self) -> None:
        return None

    async def refresh(self, instance: Player) -> None:
        instance.created_at = datetime.now(UTC)
        instance.updated_at = datetime.now(UTC)

    async def execute(self, statement: object, **_kwargs: object) -> SimpleNamespace:
        # The one statement discovery may run is the per-user tracking check
        # that fills `is_tracked`; anything touching `core.players` would be
        # the merge this regression forbids.
        assert "core.players" not in str(statement), (
            "discovery must not run a statement against other player rows"
        )
        return SimpleNamespace(scalar_one_or_none=lambda: None)

    async def scalars(self, *_args: object, **_kwargs: object) -> NoReturn:
        raise AssertionError("discovery must not search for rows sharing the Riot ID")

    async def scalar(self, *_args: object, **_kwargs: object) -> NoReturn:
        raise AssertionError("discovery must not search for rows sharing the Riot ID")

    async def delete(self, *_args: object, **_kwargs: object) -> NoReturn:
        raise AssertionError("discovery must never delete a player row")

    def expunge(self, *_args: object, **_kwargs: object) -> NoReturn:
        raise AssertionError("discovery must not detach another player row")


async def test_discovery_never_merges_a_row_sharing_the_riot_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A stale-looking row must survive discovery untouched.

    Discovery cannot tell a PUUID re-encrypted under a new developer account
    apart from a Riot ID renamed away and reclaimed by someone else. Every table
    referencing `core.players(puuid)` cascades on delete, so a wrong merge would
    destroy one player's history. A duplicate row is the accepted outcome.
    """
    monkeypatch.setattr(
        player_service_module,
        "ensure_riot_writer_maintenance_is_inactive",
        AsyncMock(),
    )
    session = _NoMergeSession()
    service = PlayerService(cast(AsyncSession, session))
    riot_client = SimpleNamespace(
        get_account_by_riot_id=AsyncMock(
            return_value=SimpleNamespace(
                puuid=FRESH_PUUID, game_name="Shared Name", tag_line="TAG"
            )
        ),
        get_summoner_by_puuid=AsyncMock(
            return_value=SimpleNamespace(profile_icon_id=7, summoner_level=42)
        ),
    )

    response = await service.discover_player(
        riot_client=cast(RiotAPIClient, riot_client),
        game_name="Shared Name",
        tag_line="TAG",
        platform=Platform.EUN1,
        user_id=1,
    )

    assert response.puuid == FRESH_PUUID
    assert [player.puuid for player in session.added] == [FRESH_PUUID]


class _CapturingSession:
    """Session that records the statements startup recovery issues."""

    def __init__(self) -> None:
        self.executed: list[Update] = []
        self.committed = False

    async def execute(self, statement: Update) -> SimpleNamespace:
        self.executed.append(statement)
        return SimpleNamespace(rowcount=1)

    async def commit(self) -> None:
        self.committed = True

    async def rollback(self) -> None:  # pragma: no cover - failure path only
        return None


def _target_table(statement: Update) -> str:
    """Return the qualified name of the table one UPDATE writes to."""
    table = statement.table
    assert isinstance(table, Table), "startup recovery updates a mapped table"
    return table.fullname


def _compiled(statement: Update) -> tuple[str, dict[str, Any]]:
    """Return one UPDATE's target table and its bound parameter values."""
    compiled = statement.compile()
    return _target_table(statement), dict(compiled.params)


def _indexed_active_statuses(model: type[Base], index_name: str) -> set[str]:
    """Read the statuses a table's partial unique index actually covers."""
    table = model.__table__
    assert isinstance(table, Table), f"{model.__name__} must map to a real table"
    for index in table.indexes:
        if index.name != index_name:
            continue
        predicate = str(index.dialect_options["postgresql"]["where"])
        listed = predicate.split("(")[1].split(")")[0]
        return {entry.strip().strip("'") for entry in listed.split(",")}
    raise AssertionError(f"{index_name} is missing")


async def test_startup_cancels_orphaned_player_syncs() -> None:
    """A restart must terminalize sync runs whose in-process worker is gone.

    `jobs.player_sync_runs` allows one active row per PUUID, and the route
    schedules work only for a newly created row, so an orphan left by an
    ungraceful shutdown blocks that player's updates until something closes it.
    """
    from app.features.jobs.scheduler import _cancel_orphaned_player_syncs

    session = _CapturingSession()

    await _cancel_orphaned_player_syncs(cast(AsyncSession, session))

    assert session.committed is True
    written = dict(_compiled(statement) for statement in session.executed)
    assert set(written) == {"jobs.player_sync_runs"}, (
        "core.matchmaking_analyses resumes across a restart and must be left alone"
    )

    sync = written["jobs.player_sync_runs"]
    assert sync["status"] == "cancelled"
    assert sync["completed_at"] is not None
    assert sync["error_code"] == "SYNC_CANCELLED"
    assert sync["error_message"] == (
        "The player update was cancelled before it finished."
    )
    # A Core update bypasses the model's application-side onupdate.
    assert sync["updated_at"] is not None


async def test_startup_recovery_matches_the_partial_index_exactly() -> None:
    """The predicate must equal the indexed active set, not merely overlap it.

    A missing status strands the rows this exists to release; an extra one would
    rewrite already-terminal runs as cancelled.
    """
    from app.features.jobs.models import PlayerSyncRun
    from app.features.jobs.scheduler import _cancel_orphaned_player_syncs

    session = _CapturingSession()

    await _cancel_orphaned_player_syncs(cast(AsyncSession, session))

    (statement,) = session.executed
    whereclause = statement.whereclause
    assert whereclause is not None, "the recovery update must be filtered"
    predicate = str(whereclause.compile(compile_kwargs={"literal_binds": True}))
    listed = predicate.split("(")[1].split(")")[0]
    targeted = {entry.strip().strip("'") for entry in listed.split(",")}

    assert targeted == _indexed_active_statuses(
        PlayerSyncRun, "uq_player_sync_runs_active_puuid"
    )


async def test_startup_recovery_never_touches_matchmaking_analyses() -> None:
    """Cancelling an active analysis here would discard its persisted progress.

    `start_analysis` attaches to an active row and relaunches its worker, so the
    documented restart contract is resume, not cancel. This covers only the
    startup helper; the shutdown path has its own regression below.
    """
    from app.features.jobs.scheduler import _cancel_orphaned_player_syncs

    session = _CapturingSession()

    await _cancel_orphaned_player_syncs(cast(AsyncSession, session))

    touched = {_target_table(statement) for statement in session.executed}
    assert "core.matchmaking_analyses" not in touched


async def test_task_cancellation_leaves_the_analysis_resumable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Process shutdown cancels the task; the persisted run must stay active.

    Writing a terminal row here would discard completed progress on every
    deployment, contradicting the documented restart contract. Explicit user
    cancellation is unaffected because `cancel_analysis` commits the terminal
    row before it cancels this task.
    """
    import asyncio

    from app.core.riot_api import scoped_client
    from app.features.matchmaking_analysis import service as analysis_module

    opened: list[object] = []

    class _Session:
        async def __aenter__(self) -> Self:
            opened.append(self)
            return self

        async def __aexit__(self, *_exc: object) -> None:
            return None

    monkeypatch.setattr(analysis_module.db_manager, "get_session", lambda: _Session())

    async def _cancelled(*_args: object, **_kwargs: object) -> NoReturn:
        raise asyncio.CancelledError()

    monkeypatch.setattr(scoped_client, "create_tracked_riot_api_client", _cancelled)

    service = analysis_module.MatchmakingAnalysisService(
        cast(AsyncSession, _Session()), cast(RiotAPIClient, SimpleNamespace()), _USER_ID
    )

    with pytest.raises(asyncio.CancelledError):
        await service._run_analysis_background("p" * 78, datetime.now(UTC))

    # A terminal write would have opened a second session in the handler.
    assert len(opened) == 1, "cancellation must not persist a terminal row"


async def test_failed_mandatory_recovery_stops_startup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Serving with sync rows stranded looks healthy while players poll forever.

    The route hands an orphaned active row back with `created=False`, so no
    worker is scheduled and the client never receives a terminal status.
    """
    from app.features.jobs import scheduler as scheduler_module

    ran: list[str] = []

    async def _record_executions(_db: object) -> None:
        ran.append("executions")

    class _Session:
        async def __aenter__(self) -> Self:
            return self

        async def __aexit__(self, *_exc: object) -> None:
            return None

    monkeypatch.setattr(scheduler_module.db_manager, "get_session", lambda: _Session())
    monkeypatch.setattr(
        scheduler_module,
        "_mark_stale_jobs_as_failed",
        AsyncMock(side_effect=_record_executions),
    )
    monkeypatch.setattr(
        scheduler_module,
        "_cancel_orphaned_player_syncs",
        AsyncMock(side_effect=RuntimeError("database is gone")),
    )

    with pytest.raises(scheduler_module.StartupRecoveryError):
        await scheduler_module._run_startup_recovery()

    assert ran == ["executions"], "every step still runs before the failure is raised"


async def test_a_failed_optional_recovery_does_not_stop_startup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Job-execution recovery stays best-effort; a degraded scheduler still serves."""
    from app.features.jobs import scheduler as scheduler_module

    class _Session:
        async def __aenter__(self) -> Self:
            return self

        async def __aexit__(self, *_exc: object) -> None:
            return None

    monkeypatch.setattr(scheduler_module.db_manager, "get_session", lambda: _Session())
    monkeypatch.setattr(
        scheduler_module,
        "_mark_stale_jobs_as_failed",
        AsyncMock(side_effect=RuntimeError("transient")),
    )
    monkeypatch.setattr(
        scheduler_module, "_cancel_orphaned_player_syncs", AsyncMock(return_value=None)
    )

    await scheduler_module._run_startup_recovery()


async def test_startup_recovery_failure_reaches_the_application(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`_start_scheduler_safely` swallows scheduler faults but not this one."""
    from app import main as main_module

    monkeypatch.setattr(
        main_module,
        "start_scheduler",
        AsyncMock(side_effect=main_module.StartupRecoveryError("stranded")),
    )

    with pytest.raises(main_module.StartupRecoveryError):
        await main_module._start_scheduler_safely()

    monkeypatch.setattr(
        main_module, "start_scheduler", AsyncMock(side_effect=RuntimeError("degraded"))
    )

    await main_module._start_scheduler_safely()


async def test_each_recovery_step_gets_its_own_session(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """One step's failure — including its session teardown — must not skip the next."""
    from app.features.jobs import scheduler as scheduler_module

    calls: list[str] = []
    sessions: list[object] = []

    async def _record_executions(_db: object) -> None:
        calls.append("executions")

    async def _record_player_syncs(_db: object) -> None:
        calls.append("player_syncs")

    class _Session:
        def __init__(self, fail_on_exit: bool) -> None:
            self._fail_on_exit = fail_on_exit

        async def __aenter__(self) -> Self:
            sessions.append(self)
            return self

        async def __aexit__(self, *_exc: object) -> None:
            if self._fail_on_exit:
                raise RuntimeError("session teardown failed")

    opened = iter([_Session(fail_on_exit=True), _Session(fail_on_exit=False)])
    monkeypatch.setattr(
        scheduler_module.db_manager, "get_session", lambda: next(opened)
    )
    monkeypatch.setattr(
        scheduler_module,
        "_mark_stale_jobs_as_failed",
        AsyncMock(side_effect=_record_executions),
    )
    monkeypatch.setattr(
        scheduler_module,
        "_cancel_orphaned_player_syncs",
        AsyncMock(side_effect=_record_player_syncs),
    )

    await scheduler_module._run_startup_recovery()

    assert calls == ["executions", "player_syncs"]
    assert len(sessions) == 2
    assert sessions[0] is not sessions[1], "each step needs its own session"


async def test_scheduler_startup_runs_recovery(monkeypatch: pytest.MonkeyPatch) -> None:
    """Pins the real `start_scheduler` call site, not just the helper.

    A test that only calls `_run_startup_recovery()` would stay green if the
    production call were deleted.
    """
    from app.features.jobs import scheduler as scheduler_module

    events: list[str] = []

    class SchedulerDouble:
        def start(self, *, paused: bool) -> None:
            assert paused is True
            events.append("start-paused")

        def remove_all_jobs(self) -> None:
            events.append("remove-stale-schedules")

        def resume(self) -> None:
            events.append("resume")

    monkeypatch.setattr(
        scheduler_module,
        "_run_startup_recovery",
        AsyncMock(side_effect=lambda: events.append("recovery")),
    )
    monkeypatch.setattr(
        scheduler_module,
        "_check_and_run_overdue_jobs",
        AsyncMock(side_effect=lambda: events.append("queue-overdue")),
    )
    monkeypatch.setattr(
        scheduler_module,
        "_load_and_schedule_jobs",
        AsyncMock(side_effect=lambda: events.append("load-schedules")),
    )
    monkeypatch.setattr(
        scheduler_module, "AsyncIOScheduler", Mock(return_value=SchedulerDouble())
    )
    monkeypatch.setattr(scheduler_module, "SQLAlchemyJobStore", Mock())
    monkeypatch.setattr(scheduler_module, "_scheduler", None)

    await scheduler_module.start_scheduler()

    assert events == [
        "recovery",
        "start-paused",
        "remove-stale-schedules",
        "load-schedules",
        "queue-overdue",
        "resume",
    ]
