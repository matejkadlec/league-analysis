"""Persist and run explicit per-player synchronization lifecycles."""

from datetime import UTC, datetime

import structlog
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import db_manager
from app.core.db_session import rollback_quietly
from app.features.jobs.base import BaseJob
from app.features.jobs.control import is_runtime_job_running
from app.features.jobs.implementations.match_fetcher import MatchFetcherJob
from app.features.jobs.implementations.player_updater import PlayerUpdaterJob
from app.features.jobs.models import (
    ACTIVE_SYNC_STATUSES,
    JobConfiguration,
    JobStatus,
    JobType,
    PlayerSyncRun,
)
from app.features.players.models import Player

logger = structlog.get_logger(__name__)


class SyncBusyError(Exception):
    """A sync start refused because another update holds the pipeline.

    Raised instead of creating a run the job layer would only fail with
    SYNC_BUSY minutes later. `message` is the client-safe sentence, naming
    the running player when one is known.
    """

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


async def _busy_message(db: AsyncSession, puuid: str) -> str | None:
    """The refusal sentence when the sync pipeline is held, else None.

    Two holders are visible before a run is created: another player's active
    `PlayerSyncRun`, and the writers' runtime keys — which the scheduled Match
    Fetcher claims too. A race past this check is caught by the job layer.
    """
    other_active = await db.scalar(
        select(PlayerSyncRun)
        .where(
            PlayerSyncRun.puuid != puuid,
            PlayerSyncRun.status.in_(ACTIVE_SYNC_STATUSES),
        )
        .limit(1)
    )
    if other_active is not None:
        running_player = await db.get(Player, other_active.puuid)
        if running_player is not None:
            return (
                f"An update for {running_player.game_name}"
                f"#{running_player.tag_line} is still running. "
                "Showing stored data instead."
            )
        return "Another player's update is still running. Showing stored data instead."

    writer_configs = await _writer_configurations(db)
    if any(is_runtime_job_running(config.id) for config in writer_configs):
        return "A scheduled data update is still running. Showing stored data instead."
    return None


async def _writer_configurations(db: AsyncSession) -> list[JobConfiguration]:
    """The two writer configurations a sync run claims, in one read."""
    return list(
        (
            await db.execute(
                select(JobConfiguration).where(
                    JobConfiguration.job_type.in_(
                        [JobType.MATCH_FETCHER, JobType.PLAYER_UPDATER]
                    )
                )
            )
        )
        .scalars()
        .all()
    )


async def create_or_get_player_sync(
    db: AsyncSession, *, user_id: int, puuid: str
) -> tuple[PlayerSyncRun, bool]:
    """Create one active run per PUUID or attach to the existing run."""
    if await db.get(Player, puuid) is None:
        raise ValueError("Player not found")

    active = await get_active_player_sync(db, puuid)
    if active is not None:
        return active, False

    busy = await _busy_message(db, puuid)
    if busy is not None:
        raise SyncBusyError(busy)

    sync_run = PlayerSyncRun(user_id=user_id, puuid=puuid, status="pending")
    db.add(sync_run)
    try:
        await db.commit()
        await db.refresh(sync_run)
        return sync_run, True
    except IntegrityError:
        await rollback_quietly(db)
        concurrent = await get_active_player_sync(db, puuid)
        if concurrent is None:
            raise
        return concurrent, False


async def get_active_player_sync(db: AsyncSession, puuid: str) -> PlayerSyncRun | None:
    """Return the active persisted run for one player, if any."""
    return await db.scalar(
        select(PlayerSyncRun)
        .where(
            PlayerSyncRun.puuid == puuid,
            PlayerSyncRun.status.in_(ACTIVE_SYNC_STATUSES),
        )
        .order_by(PlayerSyncRun.created_at.desc())
        .limit(1)
    )


def _failure_from_job(job: BaseJob) -> tuple[str, str, str]:
    """Map an internal writer result to a stable client-safe terminal state.

    Reads only the writer's cached scalars: the job session is already closed
    here, so touching the `JobExecution` instance would raise. Only a run the
    scheduler skipped is busy -- a failed start also has no execution id.
    """
    if job.skipped_as_already_running:
        return (
            "failed",
            "SYNC_BUSY",
            "Another data update is already running. Please try again later.",
        )
    if job.has_api_key_error():
        return (
            "failed",
            "RIOT_API_KEY_INVALID",
            "The Riot API key must be updated before player data can refresh.",
        )
    if job.has_puuid_binding_error():
        return (
            "failed",
            "PLAYER_ID_STALE",
            "Riot no longer recognizes this player's stored ID. "
            "This player needs to be re-added before it can update.",
        )
    if job.job_execution_status == JobStatus.RATE_LIMITED:
        return (
            "rate_limited",
            "RIOT_RATE_LIMITED",
            "The update reached Riot's rate limit. Please try again later.",
        )
    if job.job_execution_status == JobStatus.CANCELLED:
        return (
            "cancelled",
            "SYNC_CANCELLED",
            "The player update was cancelled before it finished.",
        )
    return (
        "failed",
        "SYNC_FAILED",
        "The player update did not finish. Please try again later.",
    )


async def _finish_sync(
    sync_id: int,
    *,
    status: str,
    error_code: str | None = None,
    error_message: str | None = None,
    match_execution_id: int | None = None,
    profile_execution_id: int | None = None,
) -> None:
    """Persist one safe lifecycle update from the background orchestrator.

    A terminal row is never reopened: startup recovery or an operator may
    cancel a run while this orchestrator is mid-flight. The row lock makes the
    check hold against a cancellation committing between read and write.
    """
    async with db_manager.get_session() as db:
        sync_run = await db.get(PlayerSyncRun, sync_id, with_for_update=True)
        if sync_run is None or sync_run.status not in ACTIVE_SYNC_STATUSES:
            return
        sync_run.status = status
        sync_run.error_code = error_code
        sync_run.error_message = error_message
        if match_execution_id is not None:
            sync_run.match_execution_id = match_execution_id
        if profile_execution_id is not None:
            sync_run.profile_execution_id = profile_execution_id
        if status == "running" and sync_run.started_at is None:
            sync_run.started_at = datetime.now(UTC)
        if status not in ACTIVE_SYNC_STATUSES:
            sync_run.completed_at = datetime.now(UTC)
        await db.commit()


async def _load_player_sync(
    sync_id: int,
) -> tuple[str, JobConfiguration | None, JobConfiguration | None] | None:
    """Load an active run and the two writer configurations it needs."""
    async with db_manager.get_session() as db:
        sync_run = await db.get(PlayerSyncRun, sync_id)
        if sync_run is None or sync_run.status not in ACTIVE_SYNC_STATUSES:
            return None
        puuid = sync_run.puuid
        configs = await _writer_configurations(db)
        by_type = {config.job_type: config for config in configs}
    return (
        puuid,
        by_type.get(JobType.MATCH_FETCHER),
        by_type.get(JobType.PLAYER_UPDATER),
    )


def _writer_is_unsuccessful(job: BaseJob) -> bool:
    """True when a writer did not finish as a clean SUCCESS without warnings."""
    return (
        job.job_execution_id is None
        or job.job_execution_status != JobStatus.SUCCESS
        or job.has_errors()
    )


async def _run_sync_writer(
    job_cls: type[MatchFetcherJob] | type[PlayerUpdaterJob],
    config_id: int,
    puuid: str,
) -> MatchFetcherJob | PlayerUpdaterJob:
    """Run one writer against a single PUUID allowlist."""
    job = job_cls(
        config_id,
        triggered_by="player_sync",
        target_puuids={puuid},
    )
    await job.run()
    return job


async def _finish_failed_writer(
    sync_id: int,
    job: BaseJob,
    *,
    match_execution_id: int | None,
    profile_execution_id: int | None = None,
) -> None:
    """Map a writer outcome onto the player-sync lifecycle."""
    status, code, message = _failure_from_job(job)
    await _finish_sync(
        sync_id,
        status=status,
        error_code=code,
        error_message=message,
        match_execution_id=match_execution_id,
        profile_execution_id=profile_execution_id,
    )


async def run_player_sync(sync_id: int) -> None:
    """Run Match Fetcher then Player Updater for one exact PUUID."""
    puuid: str | None = None
    # Loading and the first status write sit inside the `try` too: the up-front
    # busy check reads any active run as a held pipeline, so a row left
    # `pending` by a failure here would block the player until startup recovery.
    try:
        loaded = await _load_player_sync(sync_id)
        if loaded is None:
            return
        puuid, match_config, profile_config = loaded
        if match_config is None or profile_config is None:
            await _finish_sync(
                sync_id,
                status="failed",
                error_code="SYNC_CONFIGURATION_MISSING",
                error_message="Player data updates are temporarily unavailable.",
            )
            return

        await _finish_sync(sync_id, status="running")
        match_job = await _run_sync_writer(MatchFetcherJob, match_config.id, puuid)
        match_execution_id = match_job.job_execution_id
        if _writer_is_unsuccessful(match_job):
            await _finish_failed_writer(
                sync_id,
                match_job,
                match_execution_id=match_execution_id,
            )
            return

        await _finish_sync(
            sync_id,
            status="running",
            match_execution_id=match_execution_id,
        )

        profile_job = await _run_sync_writer(PlayerUpdaterJob, profile_config.id, puuid)
        profile_execution_id = profile_job.job_execution_id
        if _writer_is_unsuccessful(profile_job):
            await _finish_failed_writer(
                sync_id,
                profile_job,
                match_execution_id=match_execution_id,
                profile_execution_id=profile_execution_id,
            )
            return

        await _finish_sync(
            sync_id,
            status="completed",
            match_execution_id=match_execution_id,
            profile_execution_id=profile_execution_id,
        )
    except Exception as error:
        logger.error(
            "player_sync_orchestration_failed",
            sync_id=sync_id,
            puuid=puuid,
            error_type=type(error).__name__,
            exc_info=True,
        )
        await _finish_sync(
            sync_id,
            status="failed",
            error_code="SYNC_FAILED",
            error_message="The player update did not finish. Please try again later.",
        )
