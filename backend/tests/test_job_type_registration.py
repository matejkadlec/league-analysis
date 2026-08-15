"""Every declared job type is wired all the way to a runnable implementation.

Adding a `JobType` member is the easy half of introducing a job; registering it
so the scheduler can actually run it is the half that gets forgotten. A
half-registered type is silent — configurations save, the row looks healthy, and
the job simply never executes.
"""

import pytest
from fastapi import HTTPException

from app.features.jobs.base import BaseJob
from app.features.jobs.models import JobType
from app.features.jobs.router import _create_job_instance, _create_test_job_instance
from app.features.jobs.scheduler import _get_job_registry


class _JobRow:
    """The two attributes the router's factories read off a configuration."""

    def __init__(self, job_type: JobType) -> None:
        self.id = 1
        self.job_type = job_type


def test_every_job_type_has_a_registered_implementation() -> None:
    registry = _get_job_registry()

    assert set(registry) == set(JobType)


def test_every_registered_implementation_is_a_base_job_subclass() -> None:
    for job_type, implementation in _get_job_registry().items():
        assert issubclass(implementation, BaseJob), job_type


@pytest.mark.parametrize("job_type", list(JobType))
@pytest.mark.parametrize(
    "factory", [_create_job_instance, _create_test_job_instance], ids=["run", "test"]
)
def test_the_router_can_construct_every_job_type(factory, job_type: JobType) -> None:
    """The router keeps its own per-type maps, separate from the registry.

    A type registered with the scheduler but missing from these maps schedules
    fine and then answers the request to run it with a 501, so the scheduler
    registry check above cannot stand in for this one. Calling the factories
    rather than reading their literals keeps the test honest: the maps are
    function locals, and the 501 is the real observable failure.
    """
    try:
        instance = factory(_JobRow(job_type))
    except HTTPException as error:  # pragma: no cover - the failure path
        pytest.fail(f"{job_type} is not registered in the router: {error.detail}")
    assert isinstance(instance, BaseJob)
