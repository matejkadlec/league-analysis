"""Persistent maintenance interlocks for regular Riot-data writer jobs."""

from typing import Any

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ServiceException

from .models import ExecutionType, JobConfiguration, JobType

RIOT_MAINTENANCE_MODE_KEY = "riot_maintenance_mode"
RIOT_WRITER_JOB_TYPES = frozenset({JobType.MATCH_FETCHER, JobType.PLAYER_UPDATER})

# Order is shared with the cleanup command: locking these tables in the same
# sequence everywhere is what prevents a cleanup/write lock inversion.
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


class RiotWriterMaintenanceActiveError(ServiceException):
    """Raised when cleanup has stopped a direct Riot-data writer."""

    def __init__(self) -> None:
        super().__init__("Riot data maintenance is in progress")


class RiotWriterMaintenanceConfigurationError(ServiceException):
    """Raised when the jobs API attempts to create a cleanup-owned interlock."""

    def __init__(self) -> None:
        super().__init__(
            "This setting is managed by the maintenance process and cannot be changed here."
        )


async def lock_riot_writer_tables(session: AsyncSession) -> None:
    """Acquire cleanup-compatible table locks before a Riot-data write."""
    await session.execute(
        text(f"LOCK TABLE {', '.join(RIOT_WRITER_TABLES)} IN ROW EXCLUSIVE MODE")
    )


async def locked_riot_writer_configurations(
    session: AsyncSession,
) -> dict[JobType, JobConfiguration]:
    """Lock the writer tables in cleanup-compatible order and read fresh settings."""
    await lock_riot_writer_tables(session)
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
    job_config: JobConfiguration,
    execution_type: ExecutionType,
) -> bool:
    """Return whether a regular Riot writer must stay stopped for maintenance."""
    return (
        execution_type == ExecutionType.REGULAR
        and job_config.job_type in RIOT_WRITER_JOB_TYPES
        and (job_config.config_json or {}).get(RIOT_MAINTENANCE_MODE_KEY) is True
    )


def any_riot_writer_maintenance_is_active(
    configurations: dict[JobType, JobConfiguration],
) -> bool:
    """Return whether cleanup has stopped either regular Riot writer type."""
    return any(
        riot_writer_maintenance_is_active(configuration, ExecutionType.REGULAR)
        for configuration in configurations.values()
    )


async def riot_writer_maintenance_is_active_for_session(
    session: AsyncSession,
) -> bool:
    """Read the cleanup interlock only after taking the shared writer locks."""
    configurations = await locked_riot_writer_configurations(session)
    return any_riot_writer_maintenance_is_active(configurations)


async def ensure_riot_writer_maintenance_is_inactive(session: AsyncSession) -> None:
    """Refuse a direct Riot-data writer while cleanup owns the data tables."""
    if await riot_writer_maintenance_is_active_for_session(session):
        raise RiotWriterMaintenanceActiveError()


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
    current_maintenance_mode = (
        job_type in RIOT_WRITER_JOB_TYPES
        and (current_config or {}).get(RIOT_MAINTENANCE_MODE_KEY) is True
    )
    if RIOT_MAINTENANCE_MODE_KEY in merged_config:
        if not current_maintenance_mode:
            raise RiotWriterMaintenanceConfigurationError()
        merged_config.pop(RIOT_MAINTENANCE_MODE_KEY)
    if current_maintenance_mode:
        merged_config[RIOT_MAINTENANCE_MODE_KEY] = True
    return merged_config
