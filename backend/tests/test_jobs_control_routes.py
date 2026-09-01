"""What the pause/resume/stop routes answer, per outcome of the service call.

All six routes share one shape: ask the service and turn its answer into a
404/409/200 -- "does not exist" vs "refused" is what the Jobs page acts on.
"""

from collections.abc import Awaitable, Callable
from types import SimpleNamespace
from typing import cast

import pytest
from fastapi import HTTPException

from app.features.auth.users.models import User
from app.features.jobs import scheduler as scheduler_module
from app.features.jobs.router import (
    _set_scheduled_job_suspended,
    pause_job,
    pause_test_run,
    resume_job,
    resume_test_run,
    stop_job,
    stop_test_run,
)
from app.features.jobs.schemas import JobControlActionResponse
from app.features.jobs.service import JobService

JOB_ID = 7

type ControlRoute = Callable[[JobService], Awaitable[JobControlActionResponse]]


def _admin_user() -> User:
    """The only attribute the routes read: whose audit log entry this is."""
    return cast(User, SimpleNamespace(id=1))


def _state(*, success: bool, message: str = "ok") -> JobControlActionResponse:
    return JobControlActionResponse(
        success=success,
        message=message,
        is_running=True,
        is_paused=False,
        is_stopping=False,
        is_force_stopping=False,
    )


class _ServiceDouble:
    """Answers both control methods with one scripted outcome.

    `result` is returned; an `Exception` instance is raised instead, which is
    how the 500 path is reached without a database.
    """

    def __init__(self, result: JobControlActionResponse | Exception | None) -> None:
        self.result = result
        self.calls: list[tuple[str, dict[str, object]]] = []

    def _answer(self, name: str, **kwargs: object) -> JobControlActionResponse | None:
        self.calls.append((name, kwargs))
        if isinstance(self.result, Exception):
            raise self.result
        return self.result

    async def set_job_paused(
        self, job_id: int, paused: bool, test_run: bool = False
    ) -> JobControlActionResponse | None:
        return self._answer("set_job_paused", job_id=job_id, paused=paused)

    async def request_job_stop_action(
        self, job_id: int, force: bool, test_run: bool = False
    ) -> JobControlActionResponse | None:
        return self._answer("request_job_stop_action", job_id=job_id, force=force)


def _service(result: JobControlActionResponse | Exception | None) -> JobService:
    return cast(JobService, _ServiceDouble(result))


# Each route reduced to "given a service, call me" so one body covers all six.
ROUTES: dict[str, ControlRoute] = {
    "pause": lambda svc: pause_job(JOB_ID, svc, _admin_user()),
    "resume": lambda svc: resume_job(JOB_ID, svc, _admin_user()),
    "stop": lambda svc: stop_job(JOB_ID, svc, _admin_user(), force=False),
    "test-pause": lambda svc: pause_test_run(JOB_ID, svc, _admin_user()),
    "test-resume": lambda svc: resume_test_run(JOB_ID, svc, _admin_user()),
    "test-stop": lambda svc: stop_test_run(JOB_ID, svc, _admin_user(), force=False),
}


@pytest.mark.parametrize("route", ROUTES.values(), ids=list(ROUTES))
async def test_successful_action_is_returned_unchanged(route: ControlRoute) -> None:
    state = _state(success=True, message="paused")

    assert await route(_service(state)) is state


@pytest.mark.parametrize("route", ROUTES.values(), ids=list(ROUTES))
async def test_missing_job_configuration_is_404(route: ControlRoute) -> None:
    with pytest.raises(HTTPException) as caught:
        await route(_service(None))

    assert caught.value.status_code == 404


@pytest.mark.parametrize("route", ROUTES.values(), ids=list(ROUTES))
async def test_refusal_is_409_carrying_the_service_message(
    route: ControlRoute,
) -> None:
    """A job that exists and says no is a conflict, not a miss and not a 500."""
    with pytest.raises(HTTPException) as caught:
        await route(_service(_state(success=False, message="Job is not running")))

    assert caught.value.status_code == 409
    assert caught.value.detail == "Job is not running"


@pytest.mark.parametrize("route", ROUTES.values(), ids=list(ROUTES))
async def test_an_unexpected_failure_is_not_relabelled(route: ControlRoute) -> None:
    """The route neither swallows the failure nor turns it into a 404 or 409.

    The failure must reach the app-level handler; a bare `except Exception`
    here would hide outages.
    """
    with pytest.raises(RuntimeError, match="connection reset"):
        await route(_service(RuntimeError("connection reset")))


async def test_stop_passes_its_force_flag_through() -> None:
    """`force` is the only argument that separates stop from the other two."""
    service = _ServiceDouble(_state(success=True))

    await stop_job(JOB_ID, cast(JobService, service), _admin_user(), force=True)

    assert service.calls == [
        ("request_job_stop_action", {"job_id": JOB_ID, "force": True})
    ]


async def test_pause_and_resume_differ_only_by_the_paused_flag() -> None:
    paused = _ServiceDouble(_state(success=True))
    resumed = _ServiceDouble(_state(success=True))

    await pause_job(JOB_ID, cast(JobService, paused), _admin_user())
    await resume_job(JOB_ID, cast(JobService, resumed), _admin_user())

    assert paused.calls == [("set_job_paused", {"job_id": JOB_ID, "paused": True})]
    assert resumed.calls == [("set_job_paused", {"job_id": JOB_ID, "paused": False})]


class _SchedulerDouble:
    """Records which suspend method the helper picked, or raises JobLookupError."""

    def __init__(self, *, running: bool = True, missing: bool = False) -> None:
        self.running = running
        self._missing = missing
        self.calls: list[tuple[str, str]] = []

    def _record(self, method: str, job_id: str) -> None:
        from apscheduler.jobstores.base import JobLookupError

        if self._missing:
            raise JobLookupError(job_id)
        self.calls.append((method, job_id))

    def pause_job(self, job_id: str) -> None:
        self._record("pause_job", job_id)

    def resume_job(self, job_id: str) -> None:
        self._record("resume_job", job_id)


@pytest.mark.parametrize(
    ("suspended", "expected"),
    [(True, "pause_job"), (False, "resume_job")],
)
def test_suspending_a_scheduled_job_picks_the_matching_scheduler_call(
    monkeypatch: pytest.MonkeyPatch, *, suspended: bool, expected: str
) -> None:
    double = _SchedulerDouble()
    monkeypatch.setattr(scheduler_module, "get_scheduler", lambda: double)

    _set_scheduled_job_suspended(JOB_ID, suspended=suspended)

    assert double.calls == [(expected, f"job_{JOB_ID}")]


@pytest.mark.parametrize(
    "double",
    [_SchedulerDouble(running=False), _SchedulerDouble(missing=True)],
)
def test_a_job_the_scheduler_does_not_hold_is_not_an_error(
    monkeypatch: pytest.MonkeyPatch, double: _SchedulerDouble
) -> None:
    monkeypatch.setattr(scheduler_module, "get_scheduler", lambda: double)

    _set_scheduled_job_suspended(JOB_ID, suspended=True)

    assert double.calls == []
