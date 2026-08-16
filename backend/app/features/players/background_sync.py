"""Background writer tasks queued when a tracked player is added.

These run after the add-tracked response is sent: they sync the new
player's matches and refresh their profile/league, recording a
JobExecution so the work appears in the Jobs dashboard. Moved out of the
router so they are callable and testable without a synthetic Request.
"""

from dataclasses import dataclass
from datetime import UTC
from typing import Any

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import db_manager
from app.core.riot_api.client import RiotAPIClient
from app.core.riot_api.credential_health import create_tracked_riot_api_client
from app.core.riot_api.errors import RateLimitError
from app.features.jobs.models import JobConfiguration, JobExecution, JobType
from app.features.matches.service import MatchService
from app.features.players.service import PlayerService

logger = structlog.get_logger(__name__)


async def _locked_background_writer_configuration(
    session: AsyncSession, job_type: JobType
) -> JobConfiguration | None:
    """Load a direct writer configuration after any cleanup interlock commits."""
    from app.features.jobs.maintenance import locked_riot_writer_configurations

    configurations = await locked_riot_writer_configurations(session)
    return configurations.get(job_type)


async def _maybe_start_background_writer_job(
    session: AsyncSession, job_type: JobType, puuid: str, skip_message: str
) -> tuple[JobExecution | None, bool]:
    """Create a running JobExecution unless local writer maintenance is active."""
    from sqlalchemy import func

    from app.features.jobs.maintenance import is_riot_writer_maintenance_active
    from app.features.jobs.models import ExecutionType, JobExecution, JobStatus

    job_config = await _locked_background_writer_configuration(session, job_type)
    if job_config and is_riot_writer_maintenance_active(
        job_config, ExecutionType.REGULAR
    ):
        logger.info(skip_message, puuid=puuid)
        return None, True

    job_execution = None
    if job_config:
        job_execution = JobExecution(
            job_config_id=job_config.id,
            status=JobStatus.RUNNING,
            started_at=func.now(),
            api_requests_made=0,
            records_created=0,
            records_updated=0,
            execution_log={"trigger": "new_player_added", "puuid": puuid},
        )
        session.add(job_execution)
        await session.commit()
        await session.refresh(job_execution)
    return job_execution, False


async def _mark_background_job_success(
    session: AsyncSession,
    job_execution: JobExecution | None,
    *,
    records_created: int | None = None,
    records_updated: int | None = None,
    detailed_logs: dict[str, Any],
) -> None:
    """Persist a successful background writer execution."""
    from sqlalchemy import func

    from app.features.jobs.models import JobStatus

    if not job_execution:
        return
    job_execution.status = JobStatus.SUCCESS
    job_execution.completed_at = func.now()
    if records_created is not None:
        job_execution.records_created = records_created
    if records_updated is not None:
        job_execution.records_updated = records_updated
    job_execution.detailed_logs = detailed_logs
    await session.commit()


async def _mark_background_job_failed(
    session: AsyncSession, job_execution: JobExecution | None, error_message: str
) -> None:
    """Persist a failed background writer execution."""
    from sqlalchemy import func

    from app.features.jobs.models import JobStatus

    if not job_execution:
        return
    job_execution.status = JobStatus.FAILED
    job_execution.completed_at = func.now()
    job_execution.error_message = error_message
    await session.commit()


async def _mark_background_job_rate_limited(
    session: AsyncSession, job_execution: JobExecution | None, retry_after: float | None
) -> None:
    """Persist a retryable rate-limited background match-sync execution."""
    from sqlalchemy import func

    from app.features.jobs.models import JobStatus

    if not job_execution:
        return
    job_execution.status = JobStatus.RATE_LIMITED
    job_execution.completed_at = func.now()
    job_execution.execution_log = {
        **(job_execution.execution_log or {}),
        "retry_after": retry_after,
    }
    job_execution.detailed_logs = {
        "message": "Rate limit reached while synchronizing matches",
        "retry_after": retry_after,
    }
    await session.commit()


@dataclass(frozen=True)
class _BackgroundSyncPlayer:
    """The two identity fields `sync_matches_for_player` reads.

    The background route has only the PUUID and platform from the request, not
    a loaded `Player` row, so it carries them in the smallest object that
    satisfies the service's `SyncablePlayer` contract.
    """

    puuid: str
    platform: str


async def _close_riot_client(riot_client: RiotAPIClient | None) -> None:
    """Close a tracked Riot client when one was created."""
    if riot_client is not None:
        await riot_client.close()


async def _stamp_player_match_synced(session: AsyncSession, puuid: str) -> None:
    """Record that a background match sync *fully* succeeded for this player.

    Only call this when the sync reported no per-match failures. A partial sync
    that advances `match_synced_at` is indistinguishable afterwards from a
    complete one, so the data is stale and every reader believes it is current.
    `MatchFetcherJob._process_player` gates the same stamp on its own error
    count; this path is the second caller and must agree.
    """
    from datetime import datetime

    from app.features.players.models import Player

    player_model = await session.get(Player, puuid)
    if player_model is None:
        return
    player_model.match_synced_at = datetime.now(UTC)
    await session.commit()


def _updated_record_count(profile_updated: bool, league_updated: bool) -> int:
    """Count a writer row as updated when either profile or league changed."""
    return 1 if profile_updated or league_updated else 0


async def run_background_match_sync(puuid: str, platform: str) -> None:
    """
    Background task to sync matches.
    Also creates a JobExecution entry so it appears in the Jobs dashboard.
    """
    async with db_manager.get_session() as session:
        from app.features.jobs.models import JobType

        job_execution, skipped = await _maybe_start_background_writer_job(
            session,
            JobType.MATCH_FETCHER,
            puuid,
            "Background match sync skipped during local maintenance",
        )
        if skipped:
            return

        riot_client: RiotAPIClient | None = None
        try:
            riot_client = await create_tracked_riot_api_client(session)
            match_service = MatchService(session)
            player_obj = _BackgroundSyncPlayer(puuid=puuid, platform=platform)

            logger.info("Starting background match sync", puuid=puuid)

            # `sync_matches_for_player` swallows per-match failures: anything
            # `must_abort_writer_sync` does not classify as fatal is logged and
            # handed to `on_failure`, then the loop continues. Without a
            # callback here those failures left no trace at all, and the stamp
            # below advanced as though the sync had been complete.
            sync_failures: list[tuple[str, Exception]] = []

            def record_match_sync_failure(
                operation: str,
                error: Exception,
                context: dict[str, object],
            ) -> None:
                sync_failures.append((operation, error))
                logger.warning(
                    "Background match sync failure",
                    puuid=puuid,
                    operation=operation,
                    error=str(error),
                    **context,
                )

            count = await match_service.sync_matches_for_player(
                riot_client,
                player_obj,
                on_failure=record_match_sync_failure,
            )
            if not sync_failures:
                await _stamp_player_match_synced(session, puuid)
            logger.info(
                "Background match sync completed",
                puuid=puuid,
                count=count,
                failures=len(sync_failures),
            )
            summary = f"Synced {count} matches for new player"
            if sync_failures:
                summary += (
                    f"; {len(sync_failures)} match(es) failed, freshness not advanced"
                )
            await _mark_background_job_success(
                session,
                job_execution,
                records_created=count,
                detailed_logs={"message": summary},
            )
        except RateLimitError as error:
            logger.warning(
                "Background match sync rate limited",
                puuid=puuid,
                retry_after=error.retry_after,
            )
            await _mark_background_job_rate_limited(
                session, job_execution, error.retry_after
            )
        except Exception as e:
            logger.error("Background match sync failed", puuid=puuid, error=str(e))
            await _mark_background_job_failed(session, job_execution, str(e))
        finally:
            await _close_riot_client(riot_client)


async def run_background_player_update(puuid: str, platform: str) -> None:
    """
    Background task to update player profile (name, tag, icon, level).
    Also creates a JobExecution entry so it appears in the Jobs dashboard.
    """
    async with db_manager.get_session() as session:
        from datetime import datetime

        from app.features.jobs.models import JobType
        from app.features.players.models import Player

        job_execution, skipped = await _maybe_start_background_writer_job(
            session,
            JobType.PLAYER_UPDATER,
            puuid,
            "Background player update skipped during local maintenance",
        )
        if skipped:
            return

        riot_client: RiotAPIClient | None = None
        try:
            riot_client = await create_tracked_riot_api_client(session)
            player_service = PlayerService(session)
            player_model = await session.get(Player, puuid)

            if not player_model:
                logger.warning("Player not found for profile update", puuid=puuid)
                await _mark_background_job_failed(
                    session, job_execution, "Player not found"
                )
                return

            logger.info("Starting background player profile update", puuid=puuid)
            profile_updated = await player_service.update_player_profile(
                player_model, riot_client
            )
            league_updated = await player_service.update_player_league(
                player_model, riot_client
            )
            player_model.league_synced_at = datetime.now(UTC)
            await session.commit()

            logger.info(
                "Background player profile update completed",
                puuid=puuid,
                profile_updated=profile_updated,
                league_updated=league_updated,
            )
            await _mark_background_job_success(
                session,
                job_execution,
                records_updated=_updated_record_count(profile_updated, league_updated),
                detailed_logs={
                    "message": "Updated profile for new player",
                    "profile_updated": profile_updated,
                    "league_updated": league_updated,
                },
            )
        except Exception as e:
            logger.error("Background player update failed", puuid=puuid, error=str(e))
            await _mark_background_job_failed(session, job_execution, str(e))
        finally:
            await _close_riot_client(riot_client)
