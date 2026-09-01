"""`JobService` decisions that shape what the jobs UI is told.

Control responses drive a card's buttons, so a wrong answer here is silent: the
page renders, it just describes a run that is not happening.
"""

from datetime import UTC, datetime
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.jobs import control as control_module
from app.features.jobs.models import JobConfiguration, JobType
from app.features.jobs.schemas import (
    JobConfigurationResponse,
    JobConfigurationUpdate,
)
from app.features.jobs.service import JobService


def _job_configuration_double(**attributes: object) -> JobConfiguration:
    """A structural stand-in for a `job_configurations` row."""
    return cast(JobConfiguration, SimpleNamespace(**attributes))


class _UpdateSession:
    """A session that hands back one configuration row and accepts the write."""

    def __init__(self, job: JobConfiguration) -> None:
        self._job = job

    async def execute(self, statement: object) -> object:
        return SimpleNamespace(scalar_one_or_none=lambda: self._job)

    async def commit(self) -> None:
        return None

    async def refresh(self, _job: object) -> None:
        return None


@pytest.fixture(autouse=True)
def empty_runtime_registry(monkeypatch: pytest.MonkeyPatch) -> None:
    """No run holds a key unless a test claims one."""
    monkeypatch.setattr(control_module, "_runtime_controls", {})


async def test_a_partial_config_edit_keeps_the_fields_it_did_not_mention(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The Match Fetcher dialog submits only the field it changed.

    Replacing rather than merging drops every other tuning value on the row,
    and the job silently reverts to its defaults on the next tick.
    """
    job = _job_configuration_double(
        id=7,
        job_type=JobType.MATCH_FETCHER,
        name="match fetcher",
        schedule="900",
        is_active=True,
        config_json={"batch_size": 20, "matches_per_player": 5},
    )

    def passthrough_response(
        configuration: JobConfiguration,
    ) -> JobConfigurationResponse:
        """Assert against the updated row rather than its serialized form."""
        return cast(JobConfigurationResponse, configuration)

    monkeypatch.setattr(
        JobService, "_to_job_response", staticmethod(passthrough_response)
    )
    service = JobService(cast(AsyncSession, _UpdateSession(job)))

    updated = await service.update_job_configuration(
        7, JobConfigurationUpdate(config_json={"batch_size": 40})
    )

    assert updated is not None
    assert updated.config_json == {"batch_size": 40, "matches_per_player": 5}


def test_a_scheduled_run_does_not_make_the_test_button_read_as_running() -> None:
    """Test runs live under the negated key; the two flags must not share one.

    Reading both from the configuration id makes an ordinary scheduled run
    light up the card's test controls as though an operator had started one.
    """
    job = _job_configuration_double(
        id=3,
        job_type=JobType.MATCH_FETCHER,
        name="Match Fetcher",
        description=None,
        schedule="900",
        is_active=True,
        config_json=None,
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
        updated_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    control_module.claim_runtime_control(
        control_module.runtime_control_key(3, test_run=False), None
    )

    response = JobService._to_job_response(job)

    assert response.is_running is True
    assert response.is_test_running is False


@pytest.mark.parametrize("force", [True, False])
async def test_stopping_a_job_that_is_not_running_reports_no_run(
    force: bool,
) -> None:
    """The route turns `success=False` into a 409; reporting success hides it."""
    service = JobService(cast(AsyncSession, SimpleNamespace()))
    service.get_job_configuration_model = AsyncMock(
        return_value=_job_configuration_double(id=11, name="idle fetcher")
    )

    response = await service.request_job_stop_action(11, force=force)

    assert response is not None
    assert response.success is False
    assert response.message == "Job is not running"
    assert response.is_running is False


@pytest.mark.parametrize(
    ("force", "expected"),
    [
        (True, "Force stop requested for 'live fetcher'"),
        (False, "Graceful stop requested for 'live fetcher'"),
    ],
)
async def test_a_stop_confirmation_names_which_kind_of_stop_was_requested(
    force: bool, expected: str
) -> None:
    """A forced stop cancels the task outright; the toast has to say which ran."""
    service = JobService(cast(AsyncSession, SimpleNamespace()))
    service.get_job_configuration_model = AsyncMock(
        return_value=_job_configuration_double(id=12, name="live fetcher")
    )
    control_module.claim_runtime_control(12, None)

    response = await service.request_job_stop_action(12, force=force)

    assert response is not None
    assert response.success is True
    assert response.message == expected
    assert response.is_force_stopping is force
