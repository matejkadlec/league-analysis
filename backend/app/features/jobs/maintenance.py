"""Persistent maintenance interlocks for regular Riot-data writer jobs."""

from typing import Any

from .models import ExecutionType, JobConfiguration, JobType

RIOT_MAINTENANCE_MODE_KEY = "riot_maintenance_mode"
RIOT_WRITER_JOB_TYPES = frozenset({JobType.MATCH_FETCHER, JobType.PLAYER_UPDATER})


def is_riot_writer_maintenance_active(
    job_config: JobConfiguration,
    execution_type: ExecutionType,
) -> bool:
    """Return whether a regular Riot writer must stay stopped for maintenance."""
    return (
        execution_type == ExecutionType.REGULAR
        and job_config.job_type in RIOT_WRITER_JOB_TYPES
        and (job_config.config_json or {}).get(RIOT_MAINTENANCE_MODE_KEY) is True
    )


def preserve_riot_writer_maintenance_mode(
    job_type: JobType,
    current_config: dict[str, Any] | None,
    incoming_config: dict[str, Any] | None,
) -> dict[str, Any]:
    """Keep a cleanup interlock when an administrator updates job settings.

    Only the local cleanup command may remove the persistent interlock after it
    has again verified that no regular Riot writer is active.
    """
    merged_config = dict(incoming_config or {})
    if (
        job_type in RIOT_WRITER_JOB_TYPES
        and (current_config or {}).get(RIOT_MAINTENANCE_MODE_KEY) is True
    ):
        merged_config[RIOT_MAINTENANCE_MODE_KEY] = True
    return merged_config
