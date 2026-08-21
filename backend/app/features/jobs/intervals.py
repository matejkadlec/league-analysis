"""How a job configuration names its interval, for writers and the scheduler.

This used to live in `scheduler.py`, where every caller wrapped it in
`except Exception: logger.error(...)`. So `PUT /api/v1/jobs/{id}` with an
interval the code cannot resolve answered 200 with the new config echoed
back, committed it, and left APScheduler running the old one. It lives here
so `JobService.update_job_configuration` can refuse the value before the
commit rather than the scheduler shrugging at it afterwards.
"""

from collections.abc import Mapping
from typing import Any


class JobIntervalError(ValueError):
    """Raised when a job configuration cannot name a run interval."""


def _positive_seconds(value: object) -> int | None:
    """Return ``value`` as a positive number of seconds, or None if it is not."""
    if isinstance(value, str) and value.isdigit():
        value = int(value)
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        return None
    return value


def parse_interval_from_schedule(schedule: str) -> int | None:
    """Parse the `schedule` column, or None when it is not one of its formats.

    The three the scheduler has ever understood: `"60"`, `"interval:60"` and
    `"60s"`. Cron expressions are not among them, whatever the column comment
    used to claim.
    """
    schedule = schedule.strip().lower()
    if not schedule:
        return None

    candidate = schedule
    if schedule.startswith("interval:"):
        candidate = schedule.split(":", 1)[1].strip()
    elif schedule.endswith("s"):
        candidate = schedule[:-1]

    return max(int(candidate), 1) if candidate.isdigit() else None


def resolve_interval_seconds(
    *,
    name: str,
    schedule: str | None,
    config_json: Mapping[str, Any] | None,
) -> int:
    """Return the interval a job should run on.

    `config_json["interval_seconds"]` wins when it is set. A key that is
    present but unusable -- `0`, `-1`, `"5m"` -- is a configuration error and
    not an absent override: falling through to the schedule string would run
    the job on a source the operator did not choose. JSON `null` is absent.

    :raises JobIntervalError: When neither source yields an interval.
    """
    override = (config_json or {}).get("interval_seconds")
    if override is not None:
        seconds = _positive_seconds(override)
        if seconds is None:
            raise JobIntervalError(
                f"Job '{name}' sets interval_seconds={override!r}, which is not "
                f"a positive whole number of seconds."
            )
        return seconds

    from_schedule = parse_interval_from_schedule(schedule or "")
    if from_schedule is not None:
        return from_schedule

    raise JobIntervalError(
        f"Job '{name}' has no interval: set 'interval_seconds' in config_json, "
        f"or a schedule of '60', 'interval:60' or '60s'."
    )
