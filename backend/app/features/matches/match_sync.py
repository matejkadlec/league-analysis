"""Per-queue match synchronization and timeline-only backfill."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol

import structlog
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db_session import rollback_quietly
from app.core.error_chains import is_database_error, iter_error_chain
from app.core.riot_api.client import RiotAPIClient
from app.core.riot_api.constants import Region
from app.core.riot_api.errors import AuthenticationError, ForbiddenError, RateLimitError
from app.core.riot_api.models import MatchDTO, MatchListDTO, MatchTimelineDTO
from app.features.jobs.maintenance import (
    RiotWriterMaintenanceActiveError,
    ensure_riot_writer_maintenance_is_inactive,
)

from .match_persistence import fully_analyzed_match_ids
from .models import Match
from .participants import MatchParticipant
from .timeline import MatchTimeline, replace_match_timeline_rows

logger = structlog.get_logger(__name__)

OnFailure = Callable[[str, Exception, dict[str, Any]], None] | None
OnMatchStored = Callable[[int, str], None] | None

# The oldest release still synced. Deliberately not shared with
# `timeline._uses_historical_atakhan_contract`, which happens to test the same
# number today but records a permanent fact rather than a movable policy.
OLDEST_SYNCED_GAME_MAJOR = 16

# Bounds every id page with Riot's own filter, so a release older than
# `OLDEST_SYNCED_GAME_MAJOR` is never listed, fetched, paged past -- or
# timeline-repaired. Err early: too late drops current matches in silence.
OLDEST_SYNCED_MATCH_START_TIME = 1767225600  # 2026-01-01T00:00:00Z


def is_current_game_version(game_version: str) -> bool:
    """Whether a Riot match belongs to a release still worth syncing.

    A `>=` on the major, not a prefix match: the caller reads False as "the
    rest of this queue is older, stop paging", so a prefix form would stop
    ingestion at the first Riot major bump. An unparseable version is current.
    """
    try:
        return int(game_version.split(".", 1)[0]) >= OLDEST_SYNCED_GAME_MAJOR
    except AttributeError, TypeError, ValueError:
        logger.debug("match_sync_version_parse_failed", game_version=game_version)
        return True


class ReprocessMatch(Protocol):
    async def __call__(
        self,
        match_dto: MatchDTO,
        timeline_payload: MatchTimelineDTO | None = None,
    ) -> None: ...


def must_abort_writer_sync(error: Exception) -> bool:
    """Return whether a lower-level sync error must reach the owning job.

    `is_database_error` asks whether continuing would reuse a failed or
    unavailable session. An `IntegrityError` is the exception: it is about the
    one row, both writers roll back before re-raising, and the caller moves on.
    """
    if any(isinstance(item, IntegrityError) for item in iter_error_chain(error)):
        return False
    return is_database_error(error) or isinstance(
        error, RiotWriterMaintenanceActiveError
    )


# The Riot errors that must reach the owning job without per-match recovery:
# an expired key or an exhausted rate budget ends the run, and the job layer
# owns both signals. Every `except` on this seam spells only this tuple.
RIOT_FATAL_ERRORS: tuple[type[Exception], ...] = (
    AuthenticationError,
    ForbiddenError,
    RateLimitError,
)


@dataclass(frozen=True)
class QueueSyncContext:
    """The inputs every layer of one queue's sync shares, unchanged per call.

    Match ids, page offsets, and the per-fetch timeline policy vary between
    calls, so those stay individual parameters of the layers that read them.
    """

    session: AsyncSession
    riot_client: RiotAPIClient
    puuid: str
    region: Region
    queue_id: int
    on_failure: OnFailure
    reprocess_match: ReprocessMatch
    on_match_stored: OnMatchStored


async def fetch_queue_match_list(
    context: QueueSyncContext, start: int, count: int
) -> MatchListDTO:
    """Fetch one page of match IDs for a supported queue."""
    try:
        return await context.riot_client.get_match_list_by_puuid(
            puuid=context.puuid,
            region=context.region,
            start=start,
            count=count,
            queue=context.queue_id,
            start_time=OLDEST_SYNCED_MATCH_START_TIME,
        )
    except RIOT_FATAL_ERRORS:
        raise
    except Exception as error:
        logger.error(
            "Failed to fetch match IDs",
            puuid=context.puuid,
            queue_id=context.queue_id,
            error=str(error),
        )
        raise


async def load_queue_sync_completion_ids(
    session: AsyncSession,
    ids_list: list[str],
) -> tuple[set[str], set[str]]:
    """Load fully-analyzed IDs and IDs whose timeline rows are already complete."""
    analyzed_ids = await fully_analyzed_match_ids(session, ids_list)
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
    ids_list: list[str],
    analyzed_ids: set[str],
    timeline_complete_ids: set[str],
) -> tuple[list[str], set[str]]:
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


@dataclass(frozen=True)
class SyntheticParticipant:
    """A stored participant reduced to what timeline aggregation reads."""

    participant_id: int
    team_id: int
    puuid: str


@dataclass(frozen=True)
class SyntheticMatchInfo:
    """The `info` half of a match rebuilt from stored rows."""

    game_version: str
    participants: list[SyntheticParticipant]


@dataclass(frozen=True)
class SyntheticMatchMetadata:
    """The `metadata` half of a match rebuilt from stored rows."""

    match_id: str


@dataclass(frozen=True)
class SyntheticMatchDTO:
    """A stored match in the shape `TimelineMatch` describes."""

    metadata: SyntheticMatchMetadata
    info: SyntheticMatchInfo


def build_synthetic_match_dto(
    match_id: str,
    participants: list[MatchParticipant],
    game_version: str = "",
) -> SyntheticMatchDTO:
    """Build the minimal DTO shape timeline replacement needs for a stored match."""
    return SyntheticMatchDTO(
        metadata=SyntheticMatchMetadata(match_id=match_id),
        info=SyntheticMatchInfo(
            game_version=game_version,
            participants=[
                SyntheticParticipant(
                    participant_id=participant.participant_id,
                    team_id=participant.team_id,
                    puuid=participant.puuid,
                )
                for participant in participants
            ],
        ),
    )


async def fetch_sync_timeline(
    context: QueueSyncContext,
    match_id: str,
    *,
    operation: str,
    log_message: str,
    skip_match_on_error: bool,
) -> tuple[MatchTimelineDTO | None, bool]:
    """Fetch a timeline during queue sync. The bool is True when the match should be skipped."""
    timeline_payload: MatchTimelineDTO | None = None
    try:
        timeline_payload = await context.riot_client.get_match_timeline(
            match_id,
            region=context.region,
        )
    except RIOT_FATAL_ERRORS:
        raise
    except Exception as timeline_error:
        if must_abort_writer_sync(timeline_error):
            raise
        logger.warning(
            log_message,
            puuid=context.puuid,
            queue_id=context.queue_id,
            match_id=match_id,
            error=str(timeline_error),
        )
        if context.on_failure:
            context.on_failure(
                operation,
                timeline_error,
                {"queue_id": context.queue_id, "match_id": match_id},
            )
        return None, skip_match_on_error
    return timeline_payload, False


async def backfill_timeline_only_match(context: QueueSyncContext, match_id: str) -> int:
    """Store missing timeline aggregates for an already-analyzed match."""
    timeline_payload, should_skip = await fetch_sync_timeline(
        context,
        match_id,
        operation="timeline-only backfill",
        log_message="Timeline-only fetch failed",
        skip_match_on_error=True,
    )
    if should_skip or not timeline_payload:
        return 0
    participants_result = await context.session.execute(
        select(MatchParticipant).where(MatchParticipant.match_id == match_id)
    )
    participants = list(participants_result.scalars().all())
    if len(participants) < 10:
        logger.warning(
            "Skipping timeline-only backfill due to missing participants",
            puuid=context.puuid,
            queue_id=context.queue_id,
            match_id=match_id,
            participants_found=len(participants),
        )
        return 0
    version_result = await context.session.execute(
        select(Match.game_version).where(Match.match_id == match_id)
    )
    game_version = version_result.scalar_one_or_none() or ""
    await ensure_riot_writer_maintenance_is_inactive(context.session)
    timeline_rows = 0
    try:
        # Inside the try because `replace_match_timeline_rows` flushes, so it
        # is a second place this path can leave the session holding a failed
        # transaction -- the exact thing the handler below exists to prevent.
        timeline_rows = await replace_match_timeline_rows(
            context.session,
            build_synthetic_match_dto(match_id, participants, game_version),
            timeline_payload,
        )
        if timeline_rows == 0:
            return 0
        await context.session.commit()
    except Exception as error:
        # Without this the session is left holding a failed transaction and
        # every later match in the run fails on it, so the run's first error
        # would be the only true one.
        logger.error(
            "Failed to store a timeline-only backfill",
            match_id=match_id,
            writer="backfill_timeline_only_match",
            participants=len(participants),
            timeline_rows=timeline_rows,
            error=str(error),
        )
        await rollback_quietly(context.session)
        raise
    return 1


async def sync_full_queue_match(
    context: QueueSyncContext, match_id: str
) -> tuple[int, bool]:
    """Fetch and store one current-season match. The bool is True when the queue is done."""
    match_dto = await context.riot_client.get_match(match_id, region=context.region)
    if not is_current_game_version(match_dto.info.game_version):
        return 0, True
    timeline_payload, _should_skip = await fetch_sync_timeline(
        context,
        match_id,
        operation="match timeline fetch",
        log_message="Timeline fetch failed, storing match without timeline",
        skip_match_on_error=False,
    )
    await context.reprocess_match(match_dto, timeline_payload=timeline_payload)
    if context.on_match_stored:
        context.on_match_stored(context.queue_id, match_id)
    return 1, False


async def sync_queue_match(
    context: QueueSyncContext,
    match_id: str,
    timeline_only_ids: set[str],
) -> tuple[int, bool]:
    """Process one queue-sync match, including recoverable per-match failures."""
    try:
        if match_id in timeline_only_ids:
            stored = await backfill_timeline_only_match(context, match_id)
            return stored, False
        return await sync_full_queue_match(context, match_id)
    except RIOT_FATAL_ERRORS:
        raise
    except Exception as error:
        if must_abort_writer_sync(error):
            raise
        logger.warning(
            "Error syncing match",
            puuid=context.puuid,
            queue_id=context.queue_id,
            match_id=match_id,
            error=str(error),
        )
        if context.on_failure:
            context.on_failure(
                "match synchronization",
                error,
                {"queue_id": context.queue_id, "match_id": match_id},
            )
        return 0, False


async def sync_queue_batch(
    context: QueueSyncContext,
    ids_to_process: list[str],
    timeline_only_ids: set[str],
    keep_fetching: bool,
) -> tuple[int, bool]:
    """Process one page of queue-sync match IDs."""
    stored = 0
    for match_id in ids_to_process:
        delta, stop_queue = await sync_queue_match(context, match_id, timeline_only_ids)
        stored += delta
        if stop_queue:
            return stored, False
    return stored, keep_fetching


async def sync_single_queue_for_player(
    session: AsyncSession,
    riot_client: RiotAPIClient,
    puuid: str,
    region: Region,
    queue_id: int,
    on_failure: OnFailure,
    reprocess_match: ReprocessMatch,
    on_match_stored: OnMatchStored = None,
) -> int:
    """Sync one queue for a single player."""
    context = QueueSyncContext(
        session=session,
        riot_client=riot_client,
        puuid=puuid,
        region=region,
        queue_id=queue_id,
        on_failure=on_failure,
        reprocess_match=reprocess_match,
        on_match_stored=on_match_stored,
    )
    start = 0
    count = 100
    queue_stored = 0
    keep_fetching = True
    logger.info("Starting queue sync", puuid=puuid, queue_id=queue_id)
    while keep_fetching:
        match_list_dto = await fetch_queue_match_list(context, start, count)
        if not match_list_dto.match_ids:
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
        stored, keep_fetching = await sync_queue_batch(
            context,
            ids_to_process,
            timeline_only_ids,
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
