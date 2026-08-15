"""Per-queue match synchronization and timeline-only backfill."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any, Callable, Dict, List, Optional, Protocol

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.riot_api.db_rate_limiter import DBRateLimiter
from app.core.riot_api.errors import AuthenticationError, ForbiddenError, RateLimitError

from .models import Match
from .participants import MatchParticipant
from .timeline import MatchTimeline, replace_match_timeline_rows

logger = structlog.get_logger("app.features.matches.service")

AnalysisMatchResult = str

OnFailure = Optional[Callable[[str, Exception, dict[str, Any]], None]]
OnMatchStored = Optional[Callable[[int, str], None]]


class EnsureMaintenance(Protocol):
    async def __call__(self, session: AsyncSession) -> None: ...


class ReprocessMatch(Protocol):
    async def __call__(
        self,
        match_dto: Any,
        timeline_payload: Optional[Dict[str, Any]] = None,
    ) -> None: ...


def must_abort_writer_sync(error: Exception) -> bool:
    """Return whether a lower-level sync error must reach the owning job."""
    from app.features.jobs.error_handling import is_database_job_error
    from app.features.jobs.maintenance import RiotWriterMaintenanceActiveError

    return is_database_job_error(error) or isinstance(
        error, RiotWriterMaintenanceActiveError
    )


async def acquire_rate_limiter_or_raise(
    rate_limiter: Optional[DBRateLimiter],
) -> None:
    """Raise the same RateLimitError the queue-sync path used for a blocked slot."""
    if rate_limiter:
        can_proceed = await rate_limiter.acquire()
        if not can_proceed:
            raise RateLimitError(
                "Local rate limiter capacity unavailable",
                status_code=429,
            )


async def record_rate_limiter_request(
    rate_limiter: Optional[DBRateLimiter],
    requested: bool,
) -> None:
    if rate_limiter and requested:
        await rate_limiter.record_request()


async def fetch_queue_match_list(
    riot_client: Any,
    puuid: str,
    region: Any,
    queue_id: int,
    start: int,
    count: int,
    rate_limiter: Optional[DBRateLimiter],
) -> Any:
    """Fetch one page of match IDs for a supported queue."""
    try:
        await acquire_rate_limiter_or_raise(rate_limiter)
        match_list_dto = await riot_client.get_match_list_by_puuid(
            puuid=puuid,
            region=region,
            start=start,
            count=count,
            queue=queue_id,
        )
        if rate_limiter:
            await rate_limiter.record_request()
        return match_list_dto
    except AuthenticationError, ForbiddenError, RateLimitError:
        raise
    except Exception as error:
        logger.error(
            "Failed to fetch match IDs",
            puuid=puuid,
            queue_id=queue_id,
            error=str(error),
        )
        raise


async def load_queue_sync_completion_ids(
    session: AsyncSession,
    ids_list: List[str],
) -> tuple[set[str], set[str]]:
    """Load fully-analyzed IDs and IDs whose timeline rows are already complete."""
    analyzed_result = await session.execute(
        select(Match.match_id).where(
            Match.match_id.in_(ids_list), Match.fully_analyzed.is_(True)
        )
    )
    analyzed_ids = set(analyzed_result.scalars().all())
    timeline_counts_result = await session.execute(
        select(MatchTimeline.match_id, func.count(MatchTimeline.puuid))
        .where(MatchTimeline.match_id.in_(ids_list))
        .group_by(MatchTimeline.match_id)
    )
    timeline_complete_ids = {
        match_id
        for match_id, participant_rows in timeline_counts_result.all()
        if participant_rows >= 10
    }
    return analyzed_ids, timeline_complete_ids


def classify_queue_match_ids(
    ids_list: List[str],
    analyzed_ids: set[str],
    timeline_complete_ids: set[str],
) -> tuple[List[str], set[str]]:
    """Split a page into matches that still need work and timeline-only backfills."""
    ids_to_process = [
        match_id
        for match_id in ids_list
        if match_id not in analyzed_ids or match_id not in timeline_complete_ids
    ]
    timeline_only_ids = {
        match_id
        for match_id in ids_list
        if match_id in analyzed_ids and match_id not in timeline_complete_ids
    }
    return ids_to_process, timeline_only_ids


def build_synthetic_match_dto(
    match_id: str,
    participants: List[MatchParticipant],
    game_version: str = "",
) -> SimpleNamespace:
    """Build the minimal DTO shape timeline replacement needs for a stored match."""
    return SimpleNamespace(
        metadata=SimpleNamespace(match_id=match_id),
        info=SimpleNamespace(
            game_version=game_version,
            participants=[
                SimpleNamespace(
                    participant_id=participant.participant_id,
                    team_id=participant.team_id,
                    puuid=participant.puuid,
                )
                for participant in participants
            ],
        ),
    )


async def fetch_sync_timeline(
    riot_client: Any,
    puuid: str,
    region: Any,
    queue_id: int,
    match_id: str,
    rate_limiter: Optional[DBRateLimiter],
    on_failure: OnFailure,
    *,
    operation: str,
    log_message: str,
    skip_match_on_error: bool,
) -> tuple[Optional[Dict[str, Any]], bool]:
    """Fetch a timeline during queue sync. The bool is True when the match should be skipped."""
    timeline_payload: Optional[Dict[str, Any]] = None
    timeline_request_attempted = False
    try:
        await acquire_rate_limiter_or_raise(rate_limiter)
        timeline_request_attempted = True
        timeline_payload = await riot_client.get_match_timeline(
            match_id,
            region=region,
        )
    except AuthenticationError, ForbiddenError, RateLimitError:
        raise
    except Exception as timeline_error:
        if must_abort_writer_sync(timeline_error):
            raise
        logger.warning(
            log_message,
            puuid=puuid,
            queue_id=queue_id,
            match_id=match_id,
            error=str(timeline_error),
        )
        if on_failure:
            on_failure(
                operation,
                timeline_error,
                {"queue_id": queue_id, "match_id": match_id},
            )
        return None, skip_match_on_error
    finally:
        await record_rate_limiter_request(rate_limiter, timeline_request_attempted)
    return timeline_payload, False


async def backfill_timeline_only_match(
    session: AsyncSession,
    riot_client: Any,
    puuid: str,
    region: Any,
    queue_id: int,
    match_id: str,
    rate_limiter: Optional[DBRateLimiter],
    on_failure: OnFailure,
    ensure_maintenance: EnsureMaintenance,
) -> int:
    """Store missing timeline aggregates for an already-analyzed match."""
    timeline_payload, should_skip = await fetch_sync_timeline(
        riot_client,
        puuid,
        region,
        queue_id,
        match_id,
        rate_limiter,
        on_failure,
        operation="timeline-only backfill",
        log_message="Timeline-only fetch failed",
        skip_match_on_error=True,
    )
    if should_skip or not timeline_payload:
        return 0
    participants_result = await session.execute(
        select(MatchParticipant).where(MatchParticipant.match_id == match_id)
    )
    participants = list(participants_result.scalars().all())
    if len(participants) < 10:
        logger.warning(
            "Skipping timeline-only backfill due to missing participants",
            puuid=puuid,
            queue_id=queue_id,
            match_id=match_id,
            participants_found=len(participants),
        )
        return 0
    version_result = await session.execute(
        select(Match.game_version).where(Match.match_id == match_id)
    )
    game_version = version_result.scalar_one_or_none() or ""
    await ensure_maintenance(session)
    timeline_rows = await replace_match_timeline_rows(
        session,
        build_synthetic_match_dto(match_id, participants, game_version),
        timeline_payload,
    )
    if timeline_rows > 0:
        await session.commit()
        return 1
    return 0


async def sync_full_queue_match(
    riot_client: Any,
    puuid: str,
    region: Any,
    queue_id: int,
    match_id: str,
    rate_limiter: Optional[DBRateLimiter],
    on_failure: OnFailure,
    is_current_game_version: Callable[[str], bool],
    reprocess_match: ReprocessMatch,
    on_match_stored: OnMatchStored,
) -> tuple[int, bool]:
    """Fetch and store one current-season match. The bool is True when the queue is done."""
    await acquire_rate_limiter_or_raise(rate_limiter)
    match_dto = await riot_client.get_match(match_id, region=region)
    if rate_limiter:
        await rate_limiter.record_request()
    if not match_dto:
        return 0, False
    if not is_current_game_version(match_dto.info.game_version):
        return 0, True
    timeline_payload, _should_skip = await fetch_sync_timeline(
        riot_client,
        puuid,
        region,
        queue_id,
        match_id,
        rate_limiter,
        on_failure,
        operation="match timeline fetch",
        log_message="Timeline fetch failed, storing match without timeline",
        skip_match_on_error=False,
    )
    await reprocess_match(match_dto, timeline_payload=timeline_payload)
    if on_match_stored:
        on_match_stored(queue_id, match_id)
    return 1, False


async def process_queue_sync_match(
    session: AsyncSession,
    riot_client: Any,
    puuid: str,
    region: Any,
    queue_id: int,
    match_id: str,
    timeline_only_ids: set[str],
    rate_limiter: Optional[DBRateLimiter],
    on_failure: OnFailure,
    ensure_maintenance: EnsureMaintenance,
    is_current_game_version: Callable[[str], bool],
    reprocess_match: ReprocessMatch,
    on_match_stored: OnMatchStored,
) -> tuple[int, bool]:
    """Process one queue-sync match, including recoverable per-match failures."""
    try:
        if match_id in timeline_only_ids:
            stored = await backfill_timeline_only_match(
                session,
                riot_client,
                puuid,
                region,
                queue_id,
                match_id,
                rate_limiter,
                on_failure,
                ensure_maintenance,
            )
            return stored, False
        return await sync_full_queue_match(
            riot_client,
            puuid,
            region,
            queue_id,
            match_id,
            rate_limiter,
            on_failure,
            is_current_game_version,
            reprocess_match,
            on_match_stored,
        )
    except AuthenticationError, ForbiddenError, RateLimitError:
        raise
    except Exception as error:
        if must_abort_writer_sync(error):
            raise
        logger.warning(
            "Error syncing match",
            puuid=puuid,
            queue_id=queue_id,
            match_id=match_id,
            error=str(error),
        )
        if on_failure:
            on_failure(
                "match synchronization",
                error,
                {"queue_id": queue_id, "match_id": match_id},
            )
        return 0, False


async def process_queue_sync_batch(
    session: AsyncSession,
    riot_client: Any,
    puuid: str,
    region: Any,
    queue_id: int,
    ids_to_process: List[str],
    timeline_only_ids: set[str],
    rate_limiter: Optional[DBRateLimiter],
    on_failure: OnFailure,
    ensure_maintenance: EnsureMaintenance,
    is_current_game_version: Callable[[str], bool],
    reprocess_match: ReprocessMatch,
    on_match_stored: OnMatchStored,
    keep_fetching: bool,
) -> tuple[int, bool]:
    """Process one page of queue-sync match IDs."""
    stored = 0
    for match_id in ids_to_process:
        delta, stop_queue = await process_queue_sync_match(
            session,
            riot_client,
            puuid,
            region,
            queue_id,
            match_id,
            timeline_only_ids,
            rate_limiter,
            on_failure,
            ensure_maintenance,
            is_current_game_version,
            reprocess_match,
            on_match_stored,
        )
        stored += delta
        if stop_queue:
            return stored, False
    return stored, keep_fetching


async def sync_single_queue_for_player(
    session: AsyncSession,
    riot_client: Any,
    puuid: str,
    region: Any,
    queue_id: int,
    rate_limiter: Optional[DBRateLimiter],
    on_failure: OnFailure,
    ensure_maintenance: EnsureMaintenance,
    is_current_game_version: Callable[[str], bool],
    reprocess_match: ReprocessMatch,
    on_match_stored: OnMatchStored = None,
) -> int:
    """Sync one queue for a single player."""
    start = 0
    count = 100
    queue_stored = 0
    keep_fetching = True
    logger.info("Starting queue sync", puuid=puuid, queue_id=queue_id)
    while keep_fetching:
        match_list_dto = await fetch_queue_match_list(
            riot_client,
            puuid,
            region,
            queue_id,
            start,
            count,
            rate_limiter,
        )
        if not match_list_dto or not match_list_dto.match_ids:
            break
        ids_list = match_list_dto.match_ids
        analyzed_ids, timeline_complete_ids = await load_queue_sync_completion_ids(
            session,
            ids_list,
        )
        ids_to_process, timeline_only_ids = classify_queue_match_ids(
            ids_list,
            analyzed_ids,
            timeline_complete_ids,
        )
        stored, keep_fetching = await process_queue_sync_batch(
            session,
            riot_client,
            puuid,
            region,
            queue_id,
            ids_to_process,
            timeline_only_ids,
            rate_limiter,
            on_failure,
            ensure_maintenance,
            is_current_game_version,
            reprocess_match,
            on_match_stored,
            keep_fetching,
        )
        queue_stored += stored
        if not keep_fetching or len(ids_list) < count:
            break
        start += count
    logger.info(
        "Completed queue sync",
        puuid=puuid,
        queue_id=queue_id,
        stored=queue_stored,
    )
    return queue_stored
