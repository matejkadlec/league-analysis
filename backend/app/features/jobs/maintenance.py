"""Persistent maintenance interlocks for regular Riot-data writer jobs."""

from typing import Any

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from .models import ExecutionType, JobConfiguration, JobType

RIOT_MAINTENANCE_MODE_KEY = "riot_maintenance_mode"
RIOT_WRITER_JOB_TYPES = frozenset({JobType.MATCH_FETCHER, JobType.PLAYER_UPDATER})

# Keep the order shared with the cleanup command. Direct player-add writers can
# subsequently change these gameplay tables, so acquiring compatible table
# locks in the same order prevents a cleanup/write lock inversion.
RIOT_WRITER_TABLES = (
    "auth.user_tracked_players",
    "core.match_timelines",
    "core.match_participants",
    "core.matches",
    "core.player_leagues",
    "core.matchmaking_analyses",
    "core.playstyle_analyses",
    "core.players",
    "jobs.job_configurations",
    "jobs.job_executions",
)


async def locked_riot_writer_configurations(
    session: AsyncSession,
) -> dict[JobType, JobConfiguration]:
    """Lock the writer tables in cleanup-compatible order and read fresh settings."""
    await session.execute(
        text(f"LOCK TABLE {', '.join(RIOT_WRITER_TABLES)} IN ROW EXCLUSIVE MODE")
    )
    result = await session.execute(
        select(JobConfiguration)
        .where(JobConfiguration.job_type.in_(RIOT_WRITER_JOB_TYPES))
        .with_for_update()
    )
    return {
        configuration.job_type: configuration
        for configuration in result.scalars().all()
    }


def riot_writer_maintenance_is_active(
    configurations: dict[JobType, JobConfiguration],
) -> bool:
    """Return whether cleanup has stopped either regular Riot writer type."""
    return any(
        is_riot_writer_maintenance_active(configuration, ExecutionType.REGULAR)
        for configuration in configurations.values()
    )


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
