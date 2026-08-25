"""Persist Riot match DTOs and reprocess stored match rows."""

from __future__ import annotations

from collections.abc import Iterable

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db_session import rollback_quietly
from app.core.riot_api.constants import normalize_platform
from app.core.riot_api.models import MatchDTO, MatchTimelineDTO, ParticipantDTO
from app.features.players.identity import upsert_player_statement

from .match_lp import initialize_participant_lp
from .models import Match
from .participants import MatchParticipant
from .timeline import replace_match_timeline_rows

logger = structlog.get_logger(__name__)


async def fully_analyzed_match_ids(
    session: AsyncSession, match_ids: Iterable[str]
) -> set[str]:
    """Which of `match_ids` are already stored with `fully_analyzed=True`.

    The one read both sync planning and the matchmaking analysis make of the
    invariant `upsert_match` writes; keeping it beside the writer keeps the
    two sides of the contract in one file.
    """
    ids_list = list(match_ids)
    if not ids_list:
        return set()
    result = await session.execute(
        select(Match.match_id).where(
            Match.match_id.in_(ids_list), Match.fully_analyzed.is_(True)
        )
    )
    return set(result.scalars().all())


def match_end_flags(participants: Iterable[ParticipantDTO]) -> tuple[bool, bool]:
    """Derive early-surrender and surrender flags from participant DTOs."""
    early_surrender = any(
        participant.game_ended_in_early_surrender for participant in participants
    )
    surrender = any(participant.game_ended_in_surrender for participant in participants)
    return early_surrender, surrender


def build_match_record(
    match_dto: MatchDTO,
    platform_id: str,
    early_surrender: bool,
    surrender: bool,
    *,
    fully_analyzed: bool | None = None,
) -> Match:
    """Build a Match row from a Riot match DTO."""
    match = Match(
        match_id=match_dto.metadata.match_id,
        platform=normalize_platform(platform_id),
        game_creation_timestamp=match_dto.info.game_creation_timestamp,
        game_start_timestamp=match_dto.info.game_start_timestamp,
        game_start_timestamp_source="riot_game_start",
        game_end_timestamp=match_dto.info.game_end_timestamp,
        game_duration=match_dto.info.game_duration,
        game_mode=match_dto.info.game_mode,
        game_type=match_dto.info.game_type,
        game_version=match_dto.info.game_version,
        map_id=match_dto.info.map_id,
        queue_id=match_dto.info.queue_id,
        early_surrender=early_surrender,
        surrender=surrender,
        game_result=match_dto.info.game_result,
    )
    if fully_analyzed is not None:
        match.fully_analyzed = fully_analyzed
    return match


async def merge_reprocess_player(
    session: AsyncSession,
    participant: ParticipantDTO,
    platform_id: str,
) -> None:
    """Upsert the skeletal player row required by the match-participant FK."""
    await session.execute(upsert_player_statement(participant, platform_id))


async def merge_reprocess_participants(
    session: AsyncSession,
    match_dto: MatchDTO,
    match_id: str,
    platform_id: str,
) -> None:
    """Upsert every participant player and match-participant row for a rematch."""
    from .transformers import MatchDTOTransformer

    for participant in match_dto.info.participants:
        await merge_reprocess_player(session, participant, platform_id)
        participant_data = MatchDTOTransformer.extract_participant_data(participant)
        participant_model = await session.merge(
            MatchParticipant(
                match_id=match_id,
                **participant_data,
            )
        )
        initialize_participant_lp(
            participant_model,
            queue_id=match_dto.info.queue_id,
            remake=participant_data["remake"],
        )


async def upsert_match(
    db: AsyncSession,
    match_dto: MatchDTO,
    timeline_payload: MatchTimelineDTO | None = None,
) -> None:
    """Upsert a match and its participants with fully_analyzed=True.

    Uses SQLAlchemy merge (upsert) to handle both insert and update cases.
    Creates skeletal Player records for FK satisfaction if missing and stores
    objective timeline aggregates when timeline payload is available.
    """
    platform_id = match_dto.info.platform
    match_id = match_dto.metadata.match_id
    timeline_rows = 0

    try:
        early_surrender, surrender = match_end_flags(match_dto.info.participants)
        await db.merge(
            build_match_record(
                match_dto,
                platform_id,
                early_surrender,
                surrender,
                fully_analyzed=True,
            )
        )
        await merge_reprocess_participants(db, match_dto, match_id, platform_id)
        timeline_rows = await replace_match_timeline_rows(
            db, match_dto, timeline_payload
        )
        await db.commit()
    except Exception as e:
        # The counts say which writer produced the failure and whether the player
        # rows the participant and timeline foreign keys need were written for it.
        logger.error(
            "Failed to upsert match",
            match_id=match_id,
            writer="upsert_match",
            participants=len(match_dto.info.participants),
            timeline_rows=timeline_rows,
            error=str(e),
        )
        await rollback_quietly(db)
        raise
