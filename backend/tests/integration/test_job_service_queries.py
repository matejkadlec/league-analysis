"""`JobService` read paths against the real schema.

Only a database answers which rows come back, so every assertion here is over
stored rows rather than over the query that fetched them.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.jobs import control as control_module
from app.features.jobs.models import (
    ExecutionType,
    JobConfiguration,
    JobExecution,
    JobStatus,
    JobType,
)
from app.features.jobs.service import JobService

pytestmark = [pytest.mark.integration, pytest.mark.enable_socket]

NOW = datetime(2026, 8, 30, 12, 0, tzinfo=UTC)


async def _stored_configuration(
    session: AsyncSession,
    *,
    name: str,
    is_active: bool = True,
    job_type: JobType = JobType.MATCH_FETCHER,
) -> JobConfiguration:
    """One `jobs.job_configurations` row."""
    configuration = JobConfiguration(
        job_type=job_type,
        name=name,
        schedule="3600",
        is_active=is_active,
        config_json={},
    )
    session.add(configuration)
    await session.flush()
    return configuration


async def _stored_execution(
    session: AsyncSession,
    configuration: JobConfiguration,
    *,
    status: JobStatus,
    execution_type: ExecutionType,
    started_at: datetime,
) -> JobExecution:
    """One `jobs.job_executions` row."""
    execution = JobExecution(
        job_config_id=configuration.id,
        started_at=started_at,
        status=status,
        execution_type=execution_type,
        api_requests_made=0,
        records_created=0,
        records_updated=0,
    )
    session.add(execution)
    await session.flush()
    return execution


@pytest.fixture(autouse=True)
def empty_runtime_registry(monkeypatch: pytest.MonkeyPatch) -> None:
    """No run holds a key unless a test says so."""
    monkeypatch.setattr(control_module, "_runtime_controls", {})


async def test_the_latest_execution_skips_a_newer_test_run(
    database_session: AsyncSession,
) -> None:
    """ "Last run" on the jobs page means the last scheduled run.

    A test run is newer whenever an operator has just pressed Test, so an
    unfiltered lookup reports the test as the job's real last outcome.
    """
    configuration = await _stored_configuration(database_session, name="fetcher")
    scheduled = await _stored_execution(
        database_session,
        configuration,
        status=JobStatus.SUCCESS,
        execution_type=ExecutionType.REGULAR,
        started_at=NOW - timedelta(hours=2),
    )
    await _stored_execution(
        database_session,
        configuration,
        status=JobStatus.FAILED,
        execution_type=ExecutionType.TEST,
        started_at=NOW,
    )

    latest = await JobService(database_session).get_latest_execution(configuration.id)

    assert latest is not None
    assert latest.id == scheduled.id
    assert latest.status is JobStatus.SUCCESS


async def test_the_running_count_ignores_an_active_test_run(
    database_session: AsyncSession,
) -> None:
    """The dashboard's "jobs running" figure counts scheduled work only."""
    configuration = await _stored_configuration(database_session, name="fetcher")
    test_execution = await _stored_execution(
        database_session,
        configuration,
        status=JobStatus.RUNNING,
        execution_type=ExecutionType.TEST,
        started_at=NOW,
    )
    control_module.claim_runtime_control(
        control_module.runtime_control_key(configuration.id, test_run=True), None
    )

    count = await JobService(database_session).get_running_execution_count()

    assert count == 0
    await database_session.refresh(test_execution)
    assert test_execution.status is JobStatus.RUNNING


async def test_the_orphan_sweep_checks_a_test_runs_own_runtime_key(
    database_session: AsyncSession,
) -> None:
    """A live test run holds the negated key, not the configuration id.

    Looking the wrong key up finds nothing, so the sweep fails the row of a
    test run that is still working -- and the sweep runs on every status poll.
    """
    configuration = await _stored_configuration(database_session, name="fetcher")
    execution = await _stored_execution(
        database_session,
        configuration,
        status=JobStatus.RUNNING,
        execution_type=ExecutionType.TEST,
        started_at=NOW,
    )
    control_module.claim_runtime_control(
        control_module.runtime_control_key(configuration.id, test_run=True), None
    )

    cleaned = await JobService(database_session)._cleanup_orphaned_running_executions()

    assert cleaned == 0
    await database_session.refresh(execution)
    assert execution.status is JobStatus.RUNNING
    assert execution.error_message is None


async def test_the_orphan_sweep_persists_the_rows_it_failed(
    database_session: AsyncSession,
) -> None:
    """Uncommitted, the sweep's work is lost and the row stays RUNNING forever."""
    configuration = await _stored_configuration(database_session, name="fetcher")
    execution = await _stored_execution(
        database_session,
        configuration,
        status=JobStatus.RUNNING,
        execution_type=ExecutionType.REGULAR,
        started_at=NOW - timedelta(days=1),
    )
    execution_id = execution.id

    cleaned = await JobService(database_session)._cleanup_orphaned_running_executions()
    assert cleaned == 1

    database_session.expunge_all()
    reloaded = await database_session.get(JobExecution, execution_id)

    assert reloaded is not None
    assert reloaded.status is JobStatus.FAILED
    assert reloaded.completed_at is not None


async def test_a_job_whose_last_run_finished_is_not_reported_as_running(
    database_session: AsyncSession,
) -> None:
    """`is_job_running` gates the player-sync trigger; a stuck True blocks it."""
    configuration = await _stored_configuration(database_session, name="fetcher")
    await _stored_execution(
        database_session,
        configuration,
        status=JobStatus.SUCCESS,
        execution_type=ExecutionType.REGULAR,
        started_at=NOW,
    )

    service = JobService(database_session)

    assert await service.is_job_running(JobType.MATCH_FETCHER) is False
    assert await service.is_job_running(JobType.PLAYER_UPDATER) is False


async def test_a_running_job_of_another_type_does_not_count_as_this_one(
    database_session: AsyncSession,
) -> None:
    """The join to the configuration is what keeps the two types apart."""
    updater = await _stored_configuration(
        database_session, name="updater", job_type=JobType.PLAYER_UPDATER
    )
    await _stored_execution(
        database_session,
        updater,
        status=JobStatus.RUNNING,
        execution_type=ExecutionType.REGULAR,
        started_at=NOW,
    )

    service = JobService(database_session)

    assert await service.is_job_running(JobType.PLAYER_UPDATER) is True
    assert await service.is_job_running(JobType.MATCH_FETCHER) is False


async def test_listing_active_configurations_leaves_the_disabled_one_out(
    database_session: AsyncSession,
) -> None:
    """A disabled job must not appear where the caller asked for active ones.

    Named against this test's own rows: the migrations seed the two
    production configurations, so the table is never empty here.
    """
    await _stored_configuration(database_session, name="live fetcher")
    await _stored_configuration(
        database_session,
        name="retired updater",
        is_active=False,
        job_type=JobType.PLAYER_UPDATER,
    )

    service = JobService(database_session)
    active = {
        job.name for job in await service.list_job_configurations(active_only=True)
    }
    every = {job.name for job in await service.list_job_configurations()}

    assert "live fetcher" in active
    assert "retired updater" not in active
    assert {"live fetcher", "retired updater"} <= every


async def test_the_first_page_of_executions_starts_at_the_newest_row(
    database_session: AsyncSession,
) -> None:
    """Page 1 is offset 0. Off by one page and the newest runs are unreachable."""
    configuration = await _stored_configuration(database_session, name="fetcher")
    executions = [
        await _stored_execution(
            database_session,
            configuration,
            status=JobStatus.SUCCESS,
            execution_type=ExecutionType.REGULAR,
            started_at=NOW - timedelta(minutes=index),
        )
        for index in range(3)
    ]

    service = JobService(database_session)
    first = await service.list_job_executions(
        job_config_id=configuration.id, page=1, size=2
    )
    second = await service.list_job_executions(
        job_config_id=configuration.id, page=2, size=2
    )

    assert first.total == 3
    assert [row.id for row in first.executions] == [
        executions[0].id,
        executions[1].id,
    ]
    assert [row.id for row in second.executions] == [executions[2].id]


async def test_the_execution_list_honours_the_status_filter(
    database_session: AsyncSession,
) -> None:
    """The jobs history filters by outcome; an ignored filter shows everything."""
    configuration = await _stored_configuration(database_session, name="fetcher")
    failed = await _stored_execution(
        database_session,
        configuration,
        status=JobStatus.FAILED,
        execution_type=ExecutionType.REGULAR,
        started_at=NOW,
    )
    await _stored_execution(
        database_session,
        configuration,
        status=JobStatus.SUCCESS,
        execution_type=ExecutionType.REGULAR,
        started_at=NOW - timedelta(minutes=5),
    )

    listed = await JobService(database_session).list_job_executions(
        job_config_id=configuration.id, status=JobStatus.FAILED
    )

    assert listed.total == 1
    assert [row.id for row in listed.executions] == [failed.id]
