"""Every declared job type is wired all the way to a runnable implementation.

Adding a `JobType` member is the easy half of introducing a job; registering it
so the scheduler can actually run it is the half that gets forgotten. A
half-registered type is silent — configurations save, the row looks healthy, and
the job simply never executes.
"""

from app.features.jobs.base import BaseJob
from app.features.jobs.models import JobType
from app.features.jobs.scheduler import _get_job_registry


def test_every_job_type_has_a_registered_implementation() -> None:
    registry = _get_job_registry()

    assert set(registry) == set(JobType)


def test_every_registered_implementation_is_a_base_job_subclass() -> None:
    for job_type, implementation in _get_job_registry().items():
        assert issubclass(implementation, BaseJob), job_type
