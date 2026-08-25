"""A job configuration that cannot name an interval must not be accepted.

A present but unusable override such as `interval_seconds: 0` must not fall
through to the schedule string, and a swallowed resolver failure must not let
`PUT /api/v1/jobs/{id}` answer 200 while APScheduler keeps the old interval.
"""

from typing import Any, cast
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.jobs.intervals import JobIntervalError, resolve_interval_seconds
from app.features.jobs.models import JobType
from app.features.jobs.schemas import JobConfigurationUpdate
from app.features.jobs.service import JobService


def test_an_override_the_scheduler_cannot_use_is_refused_not_ignored() -> None:
    for unusable in (0, -1, "5m", True, [60]):
        with pytest.raises(JobIntervalError):
            resolve_interval_seconds(
                name="Match Fetcher",
                schedule="900",
                config_json={"interval_seconds": unusable},
            )


def test_an_absent_override_falls_through_to_the_schedule() -> None:
    for config in ({}, None, {"interval_seconds": None}):
        assert (
            resolve_interval_seconds(
                name="Match Fetcher", schedule="900", config_json=config
            )
            == 900
        )


def test_the_three_schedule_formats_the_scheduler_understands() -> None:
    for schedule in ("60", "interval:60", "60s", " Interval: 60 "):
        assert (
            resolve_interval_seconds(
                name="Player Updater", schedule=schedule, config_json=None
            )
            == 60
        )


def test_a_row_with_neither_source_raises() -> None:
    for schedule in ("", None, "0 */2 * * *"):
        with pytest.raises(JobIntervalError):
            resolve_interval_seconds(
                name="Player Updater", schedule=schedule, config_json={}
            )


async def test_the_update_route_refuses_before_it_commits() -> None:
    """The write is rejected, not committed and then shrugged at."""

    class Row:
        id = 7
        name = "Match Fetcher"
        job_type = JobType.MATCH_FETCHER
        schedule = "900"
        is_active = True

        def __init__(self) -> None:
            self.config_json: dict[str, Any] = {}

    row = Row()

    class Result:
        def scalar_one_or_none(self) -> Row:
            return row

    class Session:
        def __init__(self) -> None:
            self.commit = AsyncMock()
            self.refresh = AsyncMock()

        async def execute(self, _statement: object) -> Result:
            return Result()

    session = Session()
    service = JobService(cast(AsyncSession, cast(Any, session)))

    with pytest.raises(JobIntervalError):
        await service.update_job_configuration(
            7, JobConfigurationUpdate(config_json={"interval_seconds": 0})
        )

    session.commit.assert_not_awaited()
