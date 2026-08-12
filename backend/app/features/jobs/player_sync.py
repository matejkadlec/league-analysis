"""Persist and run explicit per-player synchronization lifecycles."""

from datetime import datetime, timezone

import structlog
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import db_manager
from app.features.jobs.implementations.match_fetcher import MatchFetcherJob
from app.features.jobs.implementations.player_updater import PlayerUpdaterJob
from app.features.jobs.models import (
    JobConfiguration,
    JobStatus,
    JobType,
    PlayerSyncRun,
)
from app.features.players.models import Player

logger = structlog.get_logger(__name__)

ACTIVE_SYNC_STATUSES = ("pending", "running")


async def create_or_get_player_sync(
    db: AsyncSession, *, user_id: int, puuid: str
) -> tuple[PlayerSyncRun, bool]:
    """Create one active run per PUUID or attach to the existing run."""
    if await db.get(Player, puuid) is None:
        raise ValueError("Player not found")

    active = await db.scalar(
        select(PlayerSyncRun)
        .where(
            PlayerSyncRun.puuid == puuid,
            PlayerSyncRun.status.in_(ACTIVE_SYNC_STATUSES),
        )
        .order_by(PlayerSyncRun.created_at.desc())
        .limit(1)
    )
    if active is not None:
        return active, False

    sync_run = PlayerSyncRun(user_id=user_id, puuid=puuid, status="pending")
    db.add(sync_run)
    try:
        await db.commit()
        await db.refresh(sync_run)
        return sync_run, True
    except IntegrityError:
        await db.rollback()
        concurrent = await db.scalar(
            select(PlayerSyncRun)
            .where(
                PlayerSyncRun.puuid == puuid,
                PlayerSyncRun.status.in_(ACTIVE_SYNC_STATUSES),
            )
            .order_by(PlayerSyncRun.created_at.desc())
            .limit(1)
        )
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


def _failure_from_job(job) -> tuple[str, str, str]:
    """Map an internal writer result to a stable client-safe terminal state.

    Reads only the writer's cached scalars. A per-player Riot failure rolls the
    job session back and the session is already closed here, so touching the
    `JobExecution` instance would raise instead of classifying the failure.

    Only a run the scheduler skipped is busy. A run whose start failed also has
    no execution id, but it is a genuine failure and must not be reported as a
    competing update.
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

    A terminal row is never reopened. Startup recovery cancels runs orphaned by
    a restart and an operator may cancel one directly, while this orchestrator
    is still mid-flight, so an unguarded write would revive a cancelled run and
    could then collide with its replacement. The row lock makes the check hold
    against a cancellation committing between the read and the write.
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
            sync_run.started_at = datetime.now(timezone.utc)
        if status not in ACTIVE_SYNC_STATUSES:
            sync_run.completed_at = datetime.now(timezone.utc)
        sync_run.updated_at = datetime.now(timezone.utc)
        await db.commit()


async def run_player_sync(sync_id: int) -> None:
    """Run Match Fetcher then Player Updater for one exact PUUID."""
    async with db_manager.get_session() as db:
        sync_run = await db.get(PlayerSyncRun, sync_id)
        if sync_run is None or sync_run.status not in ACTIVE_SYNC_STATUSES:
            return
        puuid = sync_run.puuid
        configs = (
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
        by_type = {config.job_type: config for config in configs}

    match_config = by_type.get(JobType.MATCH_FETCHER)
    profile_config = by_type.get(JobType.PLAYER_UPDATER)
    if match_config is None or profile_config is None:
        await _finish_sync(
            sync_id,
            status="failed",
            error_code="SYNC_CONFIGURATION_MISSING",
            error_message="Player data updates are temporarily unavailable.",
        )
        return

    await _finish_sync(sync_id, status="running")
    try:
        match_job = MatchFetcherJob(
            match_config.id,
            triggered_by="player_sync",
            target_puuids={puuid},
        )
        await match_job.run()
        match_execution_id = match_job.job_execution_id
        if (
            match_execution_id is None
            or match_job.job_execution_status != JobStatus.SUCCESS
            or match_job.has_errors()
        ):
            status, code, message = _failure_from_job(match_job)
            await _finish_sync(
                sync_id,
                status=status,
                error_code=code,
                error_message=message,
                match_execution_id=match_execution_id,
            )
            return

        await _finish_sync(
            sync_id,
            status="running",
            match_execution_id=match_execution_id,
        )

        profile_job = PlayerUpdaterJob(
            profile_config.id,
            triggered_by="player_sync",
            target_puuids={puuid},
        )
        await profile_job.run()
        profile_execution_id = profile_job.job_execution_id
        if (
            profile_execution_id is None
            or profile_job.job_execution_status != JobStatus.SUCCESS
            or profile_job.has_errors()
        ):
            status, code, message = _failure_from_job(profile_job)
            await _finish_sync(
                sync_id,
                status=status,
                error_code=code,
                error_message=message,
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
