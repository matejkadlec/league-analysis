"""BaseJob.run() bookkeeping: the decisions that outlive one execution row.

The scheduler re-invokes one long-lived instance forever, so leaked state and
overwritten completion rows fail silently -- the job just stops working.
"""

import asyncio
from collections.abc import AsyncGenerator, Mapping, Sequence
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any, cast, override
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import Update, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.jobs import control as control_module
from app.features.jobs.base import BaseJob
from app.features.jobs.models import (
    ExecutionType,
    JobConfiguration,
    JobExecution,
    JobStatus,
    JobType,
)


def _job_configuration_double(**attributes: object) -> JobConfiguration:
    """A structural stand-in for a `job_configurations` row.

    Constructing the mapped class configures SQLAlchemy's whole mapper
    registry, which this file deliberately does not import.
    """
    return cast(JobConfiguration, SimpleNamespace(**attributes))


def _job_execution_double(**attributes: object) -> JobExecution:
    """A structural stand-in for a `job_executions` row, as above."""
    return cast(JobExecution, SimpleNamespace(**attributes))


@asynccontextmanager
async def _stub_session() -> AsyncGenerator[AsyncSession]:
    """A session object no stubbed method ever queries."""
    yield cast(AsyncSession, object())


class _RecordingSession:
    """Captures every statement the run issues outside its stubbed methods."""

    def __init__(self) -> None:
        self.statements: list[Update] = []

    async def execute(self, statement: Update) -> None:
        self.statements.append(statement)

    async def commit(self) -> None:
        return None

    async def rollback(self) -> None:
        return None


class _RecordingJob(BaseJob):
    """A job whose execute() records a fixed amount of work and one error."""

    def __init__(self, job_config_id: int = 91) -> None:
        super().__init__(job_config_id=job_config_id)
        self.run_count = 0

    @override
    async def execute(self, db: AsyncSession) -> None:
        self.run_count += 1
        self.increment_metric("records_created", 5)
        self.add_log_entry(f"ran_{self.run_count}", True)
        if self.run_count == 1:
            self.record_error(RuntimeError("boom"), operation="first tick")


def _wire_offline(job: BaseJob, *, execution_id: int = 13) -> None:
    """Stub every collaborator that would reach the database."""
    job.fail_orphaned_execution = AsyncMock()
    job.check_control_state = AsyncMock()

    async def fake_record_execution_start(db: AsyncSession) -> None:
        job.job_execution = _job_execution_double(id=execution_id)
        job.job_execution_id = execution_id
        job.job_execution_started_at = datetime.now(UTC)

    async def fake_refresh(db: AsyncSession) -> None:
        job.job_config = _job_configuration_double(
            name="writer job",
            job_type=JobType.MATCH_FETCHER,
            config_json={},
        )

    job.record_execution_start = fake_record_execution_start
    job._refresh_config = fake_refresh
    job._db_session = _stub_session


async def test_a_second_tick_reports_its_own_work_not_the_previous_ticks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """One instance runs forever, so every accumulator resets per execution.

    Without the reset the second row inherits the first's counters and its
    recorded error, which also flips a clean run's status to failed.
    """
    monkeypatch.setattr(control_module, "_runtime_controls", {})
    job = _RecordingJob()
    _wire_offline(job)
    job.record_execution_completion = AsyncMock()

    await job.run()
    first = job.record_execution_completion.await_args
    assert first is not None
    assert first.kwargs["success"] is False

    await job.run()
    second = job.record_execution_completion.await_args
    assert second is not None

    assert job.run_count == 2
    assert second.kwargs["success"] is True
    assert job.metrics["records_created"] == 5
    assert job.has_errors() is False
    assert "ran_1" not in job.execution_log


async def test_a_failed_start_releases_the_key_so_the_next_tick_can_run(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`run()` returns before its `finally`, so `_begin_run` must release.

    A leaked key makes every later tick skip as already-running: the job
    stops for good and nothing raises.
    """
    monkeypatch.setattr(control_module, "_runtime_controls", {})
    job = _RecordingJob()
    _wire_offline(job)
    job.record_execution_completion = AsyncMock()

    failing_start = AsyncMock(side_effect=RuntimeError("no execution row"))
    job.record_execution_start = failing_start

    await job.run()
    assert job.run_count == 0
    assert control_module._runtime_controls == {}

    _wire_offline(job)
    await job.run()
    assert job.run_count == 1
    assert job.skipped_as_already_running is False


async def test_a_recorded_completion_is_not_overwritten_on_the_way_out(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The unfinished-execution sweep in `finally` must respect the flag.

    It runs after every execution, successful ones included, so dropping the
    guard rewrites each finished row to FAILED.
    """
    monkeypatch.setattr(control_module, "_runtime_controls", {})
    job = _RecordingJob()
    _wire_offline(job)

    session = _RecordingSession()

    async def fake_completion(
        db: AsyncSession,
        success: bool = True,
        error_message: str | None = None,
        logs: Sequence[Mapping[str, Any]] | None = None,
        status: JobStatus | None = None,
    ) -> None:
        job._completion_logged = True
        job.job_execution_status = JobStatus.SUCCESS

    job.record_execution_completion = fake_completion

    @asynccontextmanager
    async def recording_session() -> AsyncGenerator[AsyncSession]:
        yield cast(AsyncSession, session)

    job._db_session = recording_session

    await job.run()

    assert job.job_execution_status is JobStatus.SUCCESS
    assert session.statements == []


async def test_an_unrecorded_completion_is_closed_out_as_failed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The other half of the same guard: a row left RUNNING is still closed."""
    monkeypatch.setattr(control_module, "_runtime_controls", {})
    job = _RecordingJob()
    _wire_offline(job)

    session = _RecordingSession()

    async def fake_completion(
        db: AsyncSession,
        success: bool = True,
        error_message: str | None = None,
        logs: Sequence[Mapping[str, Any]] | None = None,
        status: JobStatus | None = None,
    ) -> None:
        """A completion write that never landed leaves the flag unset."""
        return None

    job.record_execution_completion = fake_completion

    @asynccontextmanager
    async def recording_session() -> AsyncGenerator[AsyncSession]:
        yield cast(AsyncSession, session)

    job._db_session = recording_session

    await job.run()

    assert job.job_execution_status is JobStatus.FAILED
    assert len(session.statements) == 1


class _PausingJob(BaseJob):
    """A job that parks in `check_control_state` for its whole execution."""

    def __init__(self) -> None:
        super().__init__(job_config_id=77)

    @override
    async def execute(self, db: AsyncSession) -> None:
        return None


async def test_a_paused_run_resumes_once_the_flag_clears(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The wait loop re-reads the registry, so a resume is actually observed.

    Reading the snapshot once outside the loop parks the run forever: it
    holds its runtime key, so the job never runs again either.
    """
    monkeypatch.setattr(control_module, "_runtime_controls", {})
    job = _PausingJob()
    job.job_execution = _job_execution_double(id=5, status=JobStatus.RUNNING)
    statuses: list[JobStatus] = []

    async def record_status(db: AsyncSession, status: JobStatus) -> None:
        statuses.append(status)

    job._set_execution_status = record_status

    key = job.runtime_key
    assert control_module.claim_runtime_control(key, None) is True
    assert control_module.set_runtime_job_paused(key, True) is True

    waiting = asyncio.create_task(job.check_control_state(cast(AsyncSession, object())))
    await asyncio.sleep(0.05)
    assert not waiting.done()
    assert statuses == [JobStatus.PAUSED]

    assert control_module.set_runtime_job_paused(key, False) is True
    await asyncio.wait_for(waiting, timeout=5)

    assert statuses == [JobStatus.PAUSED, JobStatus.RUNNING]


async def test_the_persisted_error_copy_stops_at_twenty_and_counts_the_rest(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`execution_log` is the JSONB the UI reads back; it is bounded, the list is not."""
    monkeypatch.setattr(control_module, "_runtime_controls", {})
    job = _RecordingJob()

    for index in range(23):
        job.record_error(RuntimeError("boom"), operation=f"step {index}")

    persisted = cast(list[dict[str, Any]], job.execution_log["errors"])
    assert len(persisted) == 20
    assert len(job._errors_encountered) == 23
    assert job.execution_log["errors_truncated"] == 3


async def test_the_twentieth_error_is_persisted_and_not_yet_counted_as_truncated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The boundary itself: 20 fit, and no truncation key is written for them."""
    monkeypatch.setattr(control_module, "_runtime_controls", {})
    job = _RecordingJob()

    for index in range(20):
        job.record_error(RuntimeError("boom"), operation=f"step {index}")

    persisted = cast(list[dict[str, Any]], job.execution_log["errors"])
    assert len(persisted) == 20
    assert "errors_truncated" not in job.execution_log


class _OrphanScopedSession:
    """Captures the orphan-cleanup select so its filters can be read back."""

    def __init__(self) -> None:
        self.statements: list[object] = []
        self.committed = False

    async def execute(self, statement: object) -> object:
        self.statements.append(statement)
        return SimpleNamespace(scalar_one_or_none=lambda: None)

    async def commit(self) -> None:
        self.committed = True


async def test_orphan_cleanup_only_looks_at_its_own_execution_type() -> None:
    """A test run and a scheduled run share a config id but not a row.

    Without the filter a starting test run fails the live regular run's row,
    which the status route then reports as a crashed job.
    """
    job = _RecordingJob()
    job.execution_type = ExecutionType.TEST
    session = _OrphanScopedSession()

    await job.fail_orphaned_execution(cast(AsyncSession, session))

    assert len(session.statements) == 1
    rendered = str(
        session.statements[0].compile(compile_kwargs={"literal_binds": True})  # type: ignore[attr-defined]
    )
    assert "execution_type" in rendered
    assert "TEST" in rendered


class _FlakyCompletionSession:
    """Fails the first commit, accepts the second."""

    def __init__(self) -> None:
        self.executes = 0
        self.commits = 0

    async def execute(self, statement: Update) -> None:
        self.executes += 1

    async def commit(self) -> None:
        self.commits += 1
        if self.commits == 1:
            raise RuntimeError("connection lost")

    async def rollback(self) -> None:
        return None


async def test_a_completion_write_is_retried_once_after_a_failed_commit() -> None:
    """A dropped connection at completion must not strand the row RUNNING.

    The retry re-issues the statement after the rollback; skipping the
    re-execute commits an empty transaction and reports success.
    """
    job = _RecordingJob()
    job.job_execution_id = 31
    session = _FlakyCompletionSession()
    statement = update(JobExecution).where(JobExecution.id == 31)

    committed = await job._execute_completion_update(
        cast(AsyncSession, session), statement
    )

    assert committed is True
    assert session.executes == 2
    assert session.commits == 2
