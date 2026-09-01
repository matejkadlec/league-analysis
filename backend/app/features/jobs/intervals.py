"""How a job configuration names its interval, for writers and the scheduler.

Resolving here rather than in the scheduler lets writers refuse an unusable
interval before the commit, instead of storing one the scheduler then ignores.
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

    The scheduler understands `"60"`, `"interval:60"` and `"60s"`; cron
    expressions are not among them.
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

    `config_json["interval_seconds"]` wins when set; a present but unusable
    value (`0`, `-1`, `"5m"`) is an error, and `null` counts as absent.

    Raises:
        JobIntervalError: When neither source yields an interval.
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
