"""Smart match-history analysis: fetch, filter, and upsert current-season games."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.riot_api.client import RiotAPIClient
from app.core.riot_api.db_rate_limiter import DBRateLimiter
from app.core.riot_api.models import MatchListDTO

from .match_sync import AnalysisMatchResult, ReprocessMatch
from .models import Match
from .participants import MatchParticipant
from .timeline import MatchTimeline

logger = structlog.get_logger("app.features.matches.service")

# Reported as `(current, total)`; the loop awaits it for every queued match.
ProgressCallback = Callable[[int, int], Awaitable[None]]
# Polled between matches so a caller can stop a long analysis run early.
CancelCheck = Callable[[], bool]


def extract_queue_match_ids(match_list: MatchListDTO | list[str] | None) -> list[str]:
    """Accept both DTO objects and bare match-id lists from the Riot client."""
    if not match_list:
        return []
    if isinstance(match_list, list):
        return match_list
    if hasattr(match_list, "match_ids"):
        return list(match_list.match_ids)
    return []


def append_unique_match_ids(
    api_match_ids: list[str],
    seen_match_ids: set[str],
    queue_match_ids: list[str],
) -> None:
    """Preserve first-seen order while merging per-queue match IDs."""
    for match_id in queue_match_ids:
        if match_id in seen_match_ids:
            continue
        seen_match_ids.add(match_id)
        api_match_ids.append(match_id)


async def collect_analysis_api_match_ids(
    riot_api_client: RiotAPIClient,
    puuid: str,
    target_queue_ids: list[int],
    rate_limiter: DBRateLimiter | None,
) -> list[str]:
    """Fetch recent match IDs for each requested queue, stopping on rate limits."""
    api_match_ids: list[str] = []
    seen_match_ids: set[str] = set()
    for queue_id in target_queue_ids:
        if rate_limiter:
            can_proceed = await rate_limiter.acquire()
            if not can_proceed:
                logger.warning(
                    "Rate limit reached before match-list fetch in analysis",
                    puuid=puuid,
                    queue_id=queue_id,
                )
                break
        match_list_requested = False
        match_list = await riot_api_client.get_match_list_by_puuid(
            puuid=puuid, count=100, queue=queue_id
        )
        match_list_requested = True
        if rate_limiter and match_list_requested:
            await rate_limiter.record_request()
        append_unique_match_ids(
            api_match_ids,
            seen_match_ids,
            extract_queue_match_ids(match_list),
        )
    return api_match_ids


async def load_analysis_process_sets(
    session: AsyncSession,
    puuid: str,
    api_match_ids: list[str],
) -> tuple[list[str], set[str], set[str], set[str]]:
    """Load analyzed, incomplete, and missing-timeline sets for smart analysis."""
    existing_analyzed_result = await session.execute(
        select(Match.match_id)
        .join(MatchParticipant, Match.match_id == MatchParticipant.match_id)
        .where(
            MatchParticipant.puuid == puuid,
            Match.fully_analyzed.is_(True),
        )
    )
    existing_analyzed_ids = set(existing_analyzed_result.scalars().all())
    needs_reanalysis_result = await session.execute(
        select(Match.match_id)
        .join(MatchParticipant, Match.match_id == MatchParticipant.match_id)
        .where(
            MatchParticipant.puuid == puuid,
            Match.fully_analyzed.is_(False),
        )
    )
    needs_reanalysis_ids = set(needs_reanalysis_result.scalars().all())
    new_match_ids = [
        match_id for match_id in api_match_ids if match_id not in existing_analyzed_ids
    ]
    existing_timeline_result = await session.execute(
        select(MatchTimeline.match_id).where(
            MatchTimeline.match_id.in_(api_match_ids),
            MatchTimeline.puuid == puuid,
        )
    )
    timeline_present_ids = set(existing_timeline_result.scalars().all())
    missing_timeline_ids = {
        match_id for match_id in api_match_ids if match_id not in timeline_present_ids
    }
    return (
        new_match_ids,
        existing_analyzed_ids,
        needs_reanalysis_ids,
        missing_timeline_ids,
    )


def order_analysis_matches(
    api_match_ids: list[str],
    new_match_ids: list[str],
    needs_reanalysis_ids: set[str],
    missing_timeline_ids: set[str],
) -> list[str]:
    """Prefer Riot's newest-first order, then append leftover incomplete IDs."""
    matches_to_process = (
        set(new_match_ids) | needs_reanalysis_ids | missing_timeline_ids
    )
    ordered_to_process = [
        match_id for match_id in api_match_ids if match_id in matches_to_process
    ]
    for match_id in needs_reanalysis_ids:
        if match_id not in ordered_to_process:
            ordered_to_process.append(match_id)
    return ordered_to_process


async def fetch_analysis_timeline(
    riot_api_client: RiotAPIClient,
    puuid: str,
    match_id: str,
    rate_limiter: DBRateLimiter | None,
) -> tuple[dict[str, Any] | None, bool]:
    """Fetch a timeline for analysis. The bool is True when the limiter blocked."""
    try:
        timeline_requested = False
        if rate_limiter:
            can_proceed = await rate_limiter.acquire()
            if not can_proceed:
                logger.warning(
                    "Rate limit reached during analysis timeline fetch",
                    puuid=puuid,
                    match_id=match_id,
                )
                return None, True
        timeline_payload = await riot_api_client.get_match_timeline(match_id)
        timeline_requested = True
        if rate_limiter and timeline_requested:
            await rate_limiter.record_request()
        return timeline_payload, False
    except Exception as timeline_error:
        logger.warning(
            "Failed to fetch timeline during analysis, continuing without timeline",
            match_id=match_id,
            error=str(timeline_error),
        )
        return None, False


async def process_analysis_match(
    riot_api_client: RiotAPIClient,
    puuid: str,
    match_id: str,
    rate_limiter: DBRateLimiter | None,
    is_current_game_version: Callable[[str], bool],
    reprocess_match: ReprocessMatch,
) -> AnalysisMatchResult:
    """Fetch, version-filter, and upsert one analysis match."""
    try:
        if rate_limiter:
            can_proceed = await rate_limiter.acquire()
            if not can_proceed:
                logger.warning(
                    "Rate limit reached during analysis match fetch",
                    puuid=puuid,
                    match_id=match_id,
                )
                return "rate_limited"
        match_dto = await riot_api_client.get_match(match_id)
        if rate_limiter:
            await rate_limiter.record_request()
        if not match_dto:
            return "continue"
        game_version = match_dto.info.game_version
        if not is_current_game_version(game_version):
            logger.debug(
                "Skipping historical match",
                match_id=match_id,
                game_version=game_version,
            )
            return "skipped_season"
        timeline_payload, rate_limited = await fetch_analysis_timeline(
            riot_api_client,
            puuid,
            match_id,
            rate_limiter,
        )
        if rate_limited:
            return "rate_limited"
        await reprocess_match(match_dto, timeline_payload=timeline_payload)
        return "processed"
    except Exception as error:
        logger.error("Failed to process match", match_id=match_id, error=str(error))
        return "continue"


def apply_analysis_match_result(
    result: AnalysisMatchResult,
    processed: int,
    skipped_season: int,
) -> tuple[int, int, bool]:
    """Update analysis counters. The bool is True when processing must stop."""
    if result == "rate_limited":
        return processed, skipped_season, True
    if result == "skipped_season":
        return processed, skipped_season + 1, False
    if result == "processed":
        return processed + 1, skipped_season, False
    return processed, skipped_season, False


async def run_analysis_processing_loop(
    ordered_to_process: list[str],
    puuid: str,
    should_cancel: CancelCheck | None,
    progress_callback: ProgressCallback | None,
    riot_api_client: RiotAPIClient,
    rate_limiter: DBRateLimiter | None,
    is_current_game_version: Callable[[str], bool],
    reprocess_match: ReprocessMatch,
) -> tuple[int, int]:
    """Walk the analysis queue with cancel, progress, and rate-limit checks."""
    processed = 0
    skipped_season = 0
    total = len(ordered_to_process)
    for index, match_id in enumerate(ordered_to_process):
        if should_cancel and should_cancel():
            logger.info(
                "Analysis cancelled by user request",
                puuid=puuid,
                processed=processed,
            )
            break
        if progress_callback:
            await progress_callback(index, total)
        await asyncio.sleep(1.2)
        processed, skipped_season, should_stop = apply_analysis_match_result(
            await process_analysis_match(
                riot_api_client,
                puuid,
                match_id,
                rate_limiter,
                is_current_game_version,
                reprocess_match,
            ),
            processed,
            skipped_season,
        )
        if should_stop:
            break
    if progress_callback:
        await progress_callback(total, total)
    return processed, skipped_season
