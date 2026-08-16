# The file-level `strict` above also re-enables rules pyproject.toml turns off
# project-wide, so this restores one of them (see pyproject's comment above
# `reportUnnecessaryIsInstance`): the ORM models and the Riot DTOs describe
# values more confidently than the data does, so the `is None` guard below is
# load-bearing and must not be deleted on the word of an annotation.
# pyright: reportUnnecessaryComparison=false
"""Global match storage utilities.

Provides a single entry point for ensuring matches are fully analyzed in DB.
Any component that needs a fully-analyzed match should use `ensure_match_fully_analyzed`
instead of implementing its own storage logic. This handles:
- Matches not yet in DB → fetch from API and store with fully_analyzed=True
- Matches in DB with fully_analyzed=False → re-fetch from API and update
- Matches in DB with fully_analyzed=True → no-op (already complete)
- Timeline objective aggregates are fetched and stored when available
"""

from typing import Protocol

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db_session import rollback_quietly
from app.core.riot_api.constants import normalize_platform
from app.core.riot_api.models import MatchDTO, MatchTimelineDTO, ParticipantDTO
from app.features.matches.models import Match
from app.features.matches.participants import MatchParticipant
from app.features.matches.timeline import replace_match_timeline_rows
from app.features.players.identity import resolve_player_display_fields
from app.features.players.models import Player

logger = structlog.get_logger(__name__)


class MatchDataSource(Protocol):
    """The slice of the Riot client this module consumes.

    `RiotAPIClient` satisfies it structurally; naming the two calls here keeps
    both responses typed as the validated Riot DTOs rather than bare dicts.
    """

    async def get_match(self, match_id: str) -> MatchDTO: ...

    async def get_match_timeline(self, match_id: str) -> MatchTimelineDTO: ...


async def ensure_match_fully_analyzed(
    db: AsyncSession,
    riot_client: MatchDataSource,
    match_id: str,
) -> bool:
    """Ensure a match is stored in DB with fully_analyzed=True.

    - If match exists and fully_analyzed=True → skip (return True)
    - If match exists and fully_analyzed=False → re-fetch from API, update record
    - If match does not exist → fetch from API, insert with fully_analyzed=True

    Returns True if match is now fully analyzed in DB, False on failure.
    """
    result = await db.execute(
        select(Match.match_id, Match.fully_analyzed).where(Match.match_id == match_id)
    )
    row = result.one_or_none()

    if row is not None and row.fully_analyzed:
        return True

    try:
        match_dto = await riot_client.get_match(match_id)
    except Exception as e:
        logger.warning(
            "Failed to fetch match from API for re-analysis",
            match_id=match_id,
            error=str(e),
        )
        return row is not None

    if match_dto is None:
        return row is not None

    timeline_payload: MatchTimelineDTO | None = None
    try:
        timeline_payload = await riot_client.get_match_timeline(match_id)
    except Exception as timeline_error:
        logger.warning(
            "Failed to fetch timeline for re-analysis",
            match_id=match_id,
            error=str(timeline_error),
        )

    await upsert_match(db, match_dto, timeline_payload=timeline_payload)
    return True


def _build_fully_analyzed_match(match_dto: MatchDTO) -> Match:
    """Build a fully-analyzed match row from a Riot match DTO."""
    from app.features.matches.match_persistence import (
        build_match_record,
        match_end_flags,
    )

    platform_id = match_dto.info.platform or "EUN1"
    early_surrender, surrender = match_end_flags(match_dto.info.participants)
    return build_match_record(
        match_dto,
        platform_id,
        early_surrender,
        surrender,
        fully_analyzed=True,
    )


async def _upsert_match_participant(
    db: AsyncSession,
    match_id: str,
    participant: ParticipantDTO,
    platform_id: str,
    queue_id: int,
) -> None:
    """Merge the participant's skeletal player row and match participant row."""
    from app.features.matches.match_lp import initialize_participant_lp
    from app.features.matches.transformers import MatchDTOTransformer

    existing_player_result = await db.execute(
        select(Player).where(Player.puuid == participant.puuid)
    )
    existing_player = existing_player_result.scalar_one_or_none()
    fields = resolve_player_display_fields(participant, existing_player, platform_id)
    await db.merge(
        Player(
            puuid=participant.puuid,
            game_name=fields["game_name"],
            tag_line=fields["tag_line"],
            platform=normalize_platform(platform_id),
            profile_icon_id=fields["profile_icon_id"],
            summoner_level=fields["summoner_level"],
            is_tracked=fields["is_tracked"],
        )
    )
    participant_data = MatchDTOTransformer.extract_participant_data(participant)
    participant_model = await db.merge(
        MatchParticipant(match_id=match_id, **participant_data)
    )
    initialize_participant_lp(
        participant_model,
        queue_id=queue_id,
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
    platform_id = match_dto.info.platform or "EUN1"
    match_id = match_dto.metadata.match_id

    try:
        await db.merge(_build_fully_analyzed_match(match_dto))
        for participant in match_dto.info.participants:
            await _upsert_match_participant(
                db,
                match_id,
                participant,
                platform_id,
                match_dto.info.queue_id,
            )
        await replace_match_timeline_rows(db, match_dto, timeline_payload)
        await db.commit()
    except Exception as e:
        logger.error(
            "Failed to upsert match",
            match_id=match_id,
            error=str(e),
        )
        await rollback_quietly(db)
        raise
