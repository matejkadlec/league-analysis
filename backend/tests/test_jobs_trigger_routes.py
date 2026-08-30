"""What the trigger and test-run routes refuse, and what they hand the runner.

Both routes answer a refusal with HTTP 200 and `success=False`, so nothing
raises when they decline; the only evidence is the body and whether a task was
queued. Both assertions are made here.
"""

from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any, cast

import pytest
from fastapi import BackgroundTasks, HTTPException

from app.features.auth.users.models import User
from app.features.jobs import control as control_module
from app.features.jobs import router as router_module
from app.features.jobs.models import JobType
from app.features.jobs.router import (
    _run_test_job_with_cleanup,
    get_job_executions,
    trigger_job,
    trigger_test_run,
)
from app.features.jobs.schemas import JobConfigurationResponse
from app.features.jobs.service import JobService

JOB_ID = 7


def _admin_user() -> User:
    """The only attribute the routes read: whose audit log entry this is."""
    return cast(User, SimpleNamespace(id=1))


def _job(*, is_active: bool = True) -> JobConfigurationResponse:
    """A configuration response as the service hands one back."""
    return JobConfigurationResponse(
        id=JOB_ID,
        job_type=JobType.MATCH_FETCHER,
        name="Match Fetcher",
        description=None,
        schedule="900",
        is_active=is_active,
        config_json={},
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
        updated_at=datetime(2026, 1, 1, tzinfo=UTC),
    )


class _ServiceDouble:
    """Answers the two lookups the trigger routes make."""

    def __init__(
        self,
        job: JobConfigurationResponse | None,
        *,
        job_running: bool = False,
    ) -> None:
        self._job = job
        self._job_running = job_running
        self.listed: list[dict[str, object]] = []

    async def get_job_configuration(
        self, job_id: int
    ) -> JobConfigurationResponse | None:
        return self._job

    async def is_job_running(self, job_type: JobType) -> bool:
        return self._job_running

    async def list_job_executions(self, **kwargs: object) -> object:
        self.listed.append(kwargs)
        return SimpleNamespace(executions=[], total=0, page=1, size=20)


def _service(
    job: JobConfigurationResponse | None, *, job_running: bool = False
) -> JobService:
    return cast(JobService, _ServiceDouble(job, job_running=job_running))


BUILT_JOBS: list[dict[str, object]] = []


class _RecordedJob:
    """Stands in for a job runner and remembers how it was constructed."""

    def __init__(self, job_config_id: int, triggered_by: str = "system") -> None:
        self.job_config_id = job_config_id
        self.triggered_by = triggered_by
        self.suspend_regular = False
        BUILT_JOBS.append(
            {"job_config_id": job_config_id, "triggered_by": triggered_by}
        )

    async def run(self) -> None:
        return None


@pytest.fixture(autouse=True)
def isolated_runtime_state(monkeypatch: pytest.MonkeyPatch) -> None:
    """No run holds a key, and no test reaches the real scheduler."""
    monkeypatch.setattr(control_module, "_runtime_controls", {})
    BUILT_JOBS.clear()


async def test_an_inactive_job_cannot_be_triggered() -> None:
    """Deactivating a job in the UI has to stop manual runs too.

    Without the guard the one control an operator has for taking a job out of
    service still leaves the Run button working.
    """
    tasks = BackgroundTasks()

    with pytest.raises(HTTPException) as caught:
        await trigger_job(JOB_ID, tasks, _service(_job(is_active=False)), _admin_user())

    assert caught.value.status_code == 400
    assert tasks.tasks == []


async def test_a_job_already_running_is_refused_without_queueing_a_second_run() -> None:
    """The refusal is HTTP 200 with `success=False`, so the body is the signal.

    A queued second run would have both writing the same Riot data at once.
    """
    tasks = BackgroundTasks()

    response = await trigger_job(
        JOB_ID, tasks, _service(_job(), job_running=True), _admin_user()
    )

    assert response.success is False
    assert "already running" in response.message
    assert tasks.tasks == []


async def test_a_manual_run_is_recorded_as_triggered_by_the_user(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`triggered_by === "user"` is what the jobs UI reads to mark manual runs."""

    def record(
        job: JobConfigurationResponse, triggered_by: str = "system"
    ) -> _RecordedJob:
        return _RecordedJob(job.id, triggered_by)

    monkeypatch.setattr(router_module, "_create_job_instance", record)
    tasks = BackgroundTasks()

    response = await trigger_job(JOB_ID, tasks, _service(_job()), _admin_user())

    assert response.success is True
    assert BUILT_JOBS == [{"job_config_id": JOB_ID, "triggered_by": "user"}]
    assert len(tasks.tasks) == 1


async def test_an_unimplemented_job_type_is_501_rather_than_a_crash(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An empty registry must be named as unimplemented, not raise on None."""
    from app.features.jobs import scheduler as scheduler_module

    monkeypatch.setattr(scheduler_module, "job_registry", dict)
    tasks = BackgroundTasks()

    with pytest.raises(HTTPException) as caught:
        await trigger_job(JOB_ID, tasks, _service(_job()), _admin_user())

    assert caught.value.status_code == 501


async def test_a_second_test_run_is_refused_while_one_is_active() -> None:
    """Test runs hold the negated key; a second would share the execution row."""
    control_module.claim_runtime_control(
        control_module.runtime_control_key(JOB_ID, test_run=True), None
    )
    tasks = BackgroundTasks()

    response = await trigger_test_run(
        JOB_ID, tasks, _service(_job()), _admin_user(), suspend_regular=False
    )

    assert response.success is False
    assert "already active" in response.message
    assert tasks.tasks == []


@pytest.mark.parametrize("suspend_regular", [True, False])
async def test_suspending_the_schedule_is_the_callers_choice(
    monkeypatch: pytest.MonkeyPatch, suspend_regular: bool
) -> None:
    """`suspend_regular` is the flag the test dialog sends; it has to be obeyed."""
    suspensions: list[tuple[int, bool]] = []

    def record_suspension(job_id: int, *, suspended: bool) -> None:
        suspensions.append((job_id, suspended))

    def build_test_job(job: JobConfigurationResponse) -> Any:
        return _RecordedJob(job.id)

    monkeypatch.setattr(
        router_module, "_set_scheduled_job_suspended", record_suspension
    )
    monkeypatch.setattr(router_module, "_create_test_job_instance", build_test_job)
    tasks = BackgroundTasks()

    response = await trigger_test_run(
        JOB_ID,
        tasks,
        _service(_job()),
        _admin_user(),
        suspend_regular=suspend_regular,
    )

    assert response.success is True
    assert suspensions == ([(JOB_ID, True)] if suspend_regular else [])


async def test_the_schedule_resumes_even_when_the_test_run_raises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The suspension outlives the run, so only a `finally` can lift it.

    Left suspended, the job's scheduled runs stop for the life of the process
    and nothing reports it -- the row simply never appears again.
    """
    suspensions: list[tuple[int, bool]] = []

    def record_suspension(job_id: int, *, suspended: bool) -> None:
        suspensions.append((job_id, suspended))

    monkeypatch.setattr(
        router_module, "_set_scheduled_job_suspended", record_suspension
    )

    class _FailingJob:
        async def run(self) -> None:
            raise RuntimeError("the test run died")

    with pytest.raises(RuntimeError):
        await _run_test_job_with_cleanup(
            cast(Any, _FailingJob()), JOB_ID, suspend_regular=True
        )

    assert suspensions == [(JOB_ID, False)]


async def test_one_jobs_history_is_scoped_to_that_job() -> None:
    """The card's history pane would otherwise show every job's runs."""
    service = _ServiceDouble(_job())

    await get_job_executions(JOB_ID, cast(JobService, service))

    assert service.listed == [
        {
            "job_config_id": JOB_ID,
            "status": None,
            "execution_type": None,
            "page": 1,
            "size": 20,
        }
    ]
