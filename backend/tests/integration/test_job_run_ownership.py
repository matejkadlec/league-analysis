"""Who may write a job execution row once another owner has closed it.

A restart can leave the old worker alive while the new process's startup
recovery cancels its row. Only stored rows show whether the old worker's
later writes then land, so each test reads the row back from PostgreSQL.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import override

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.jobs import control as control_module
from app.features.jobs import scheduler as scheduler_module
from app.features.jobs.base import BaseJob, JobStopSignal
from app.features.jobs.models import (
    JobConfiguration,
    JobExecution,
    JobStatus,
    JobType,
)

pytestmark = [pytest.mark.integration, pytest.mark.enable_socket]

RECOVERY_MESSAGE_START = "Job cancelled - was still running during application startup"


class _WriterOnTheTestSession(BaseJob):
    """A regular run that works on the test's own transaction."""

    def __init__(self, job_config_id: int, session: AsyncSession) -> None:
        super().__init__(job_config_id)
        self._session = session

    @override
    @asynccontextmanager
    async def _db_session(self) -> AsyncGenerator[AsyncSession]:
        yield self._session

    @override
    async def execute(self, db: AsyncSession) -> None:
        self.increment_metric("records_created", 3)


class _RecoveredMidFlight(_WriterOnTheTestSession):
    """A run whose row a second process's startup recovery closes mid-work."""

    @override
    async def execute(self, db: AsyncSession) -> None:
        self.increment_metric("records_created", 3)
        await scheduler_module._mark_stale_jobs_as_failed(db)


class _StopsAtItsCheckpoint(_WriterOnTheTestSession):
    """The same run, asking whether it still owns its row before it writes."""

    def __init__(self, job_config_id: int, session: AsyncSession) -> None:
        super().__init__(job_config_id, session)
        self.wrote_after_its_checkpoint = False

    @override
    async def execute(self, db: AsyncSession) -> None:
        await scheduler_module._mark_stale_jobs_as_failed(db)
        await self.ensure_execution_is_owned(db)
        self.wrote_after_its_checkpoint = True


@pytest.fixture(autouse=True)
def empty_runtime_registry(monkeypatch: pytest.MonkeyPatch) -> None:
    """No run holds a key unless a test says so."""
    monkeypatch.setattr(control_module, "_runtime_controls", {})


async def _stored_configuration(session: AsyncSession) -> JobConfiguration:
    """One `jobs.job_configurations` row."""
    configuration = JobConfiguration(
        job_type=JobType.MATCH_FETCHER,
        name="fetcher",
        schedule="3600",
        is_active=True,
        config_json={},
    )
    session.add(configuration)
    await session.flush()
    return configuration


async def _only_execution(session: AsyncSession) -> JobExecution:
    """The single execution row a test's run created, read fresh."""
    result = await session.execute(
        select(JobExecution).execution_options(populate_existing=True)
    )
    return result.scalars().one()


async def test_completion_never_overwrites_a_row_recovery_already_closed(
    database_session: AsyncSession,
) -> None:
    """A worker that outlived a restart cannot rewrite its cancelled row.

    Its completion used to match the row by id alone: `CANCELLED` became
    `SUCCESS`, and the recovery's reason was erased with it.
    """
    configuration = await _stored_configuration(database_session)
    job = _RecoveredMidFlight(configuration.id, database_session)

    await job.run()

    stored = await _only_execution(database_session)
    assert stored.status is JobStatus.CANCELLED
    assert stored.error_message is not None
    assert stored.error_message.startswith(RECOVERY_MESSAGE_START)
    assert stored.records_created == 0
    assert job.job_execution_status is JobStatus.CANCELLED
    assert job.ownership_lost is True


async def test_a_run_that_still_owns_its_row_closes_it_as_before(
    database_session: AsyncSession,
) -> None:
    """The guard must not cost an undisturbed run its own completion."""
    configuration = await _stored_configuration(database_session)
    job = _WriterOnTheTestSession(configuration.id, database_session)

    await job.run()

    stored = await _only_execution(database_session)
    assert stored.status is JobStatus.SUCCESS
    assert stored.records_created == 3
    assert job.job_execution_status is JobStatus.SUCCESS
    assert job.ownership_lost is False


async def test_a_superseded_run_stops_at_its_next_checkpoint(
    database_session: AsyncSession,
) -> None:
    """Losing the row has to stop the work, not only the final write.

    Without the checkpoint the old worker keeps calling Riot and writing
    gameplay rows for as long as its loop has players left.
    """
    configuration = await _stored_configuration(database_session)
    job = _StopsAtItsCheckpoint(configuration.id, database_session)

    await job.run()

    stored = await _only_execution(database_session)
    assert job.wrote_after_its_checkpoint is False
    assert stored.status is JobStatus.CANCELLED
    assert job.ownership_lost is True


async def test_a_paused_run_cannot_reopen_its_closed_row_on_resume(
    database_session: AsyncSession,
) -> None:
    """Resuming writes `RUNNING`; over a closed row that revives the run."""
    configuration = await _stored_configuration(database_session)
    job = _WriterOnTheTestSession(configuration.id, database_session)
    await job.record_execution_start(database_session)
    await scheduler_module._mark_stale_jobs_as_failed(database_session)

    with pytest.raises(JobStopSignal, match="ownership_lost"):
        await job._set_execution_status(database_session, JobStatus.RUNNING)

    stored = await _only_execution(database_session)
    assert stored.status is JobStatus.CANCELLED


async def test_the_unfinished_run_fallback_leaves_a_closed_row_alone(
    database_session: AsyncSession,
) -> None:
    """The `finally` fallback closes a row as `FAILED` only while it is open."""
    configuration = await _stored_configuration(database_session)
    job = _WriterOnTheTestSession(configuration.id, database_session)
    await job.record_execution_start(database_session)
    await scheduler_module._mark_stale_jobs_as_failed(database_session)

    await job._fail_unfinished_execution(database_session)

    stored = await _only_execution(database_session)
    assert stored.status is JobStatus.CANCELLED
    assert job.job_execution_status is JobStatus.CANCELLED
