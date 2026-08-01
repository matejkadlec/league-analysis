"""Global match storage utilities.

Provides a single entry point for ensuring matches are fully analyzed in DB.
Any component that needs a fully-analyzed match should use `ensure_match_fully_analyzed`
instead of implementing its own storage logic. This handles:
- Matches not yet in DB → fetch from API and store with fully_analyzed=True
- Matches in DB with fully_analyzed=False → re-fetch from API and update
- Matches in DB with fully_analyzed=True → no-op (already complete)
- Timeline objective aggregates are fetched and stored when available
"""

from typing import TYPE_CHECKING, Optional

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.matches.models import Match
from app.features.matches.participants import MatchParticipant
from app.features.matches.timeline import replace_match_timeline_rows
from app.features.players.models import Player

if TYPE_CHECKING:
    from app.core.riot_api.client import RiotAPIClient

logger = structlog.get_logger(__name__)


async def ensure_match_fully_analyzed(
    db: AsyncSession,
    riot_client: "RiotAPIClient",
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

    timeline_payload = None
    try:
        timeline_payload = await riot_client.get_match_timeline(match_id)
    except Exception as timeline_error:
        logger.warning(
            "Failed to fetch timeline for re-analysis",
            match_id=match_id,
            error=str(timeline_error),
        )

    await _upsert_match(db, match_dto, timeline_payload=timeline_payload)
    return True


async def _upsert_match(
    db: AsyncSession,
    match_dto,
    timeline_payload: Optional[dict] = None,
) -> None:
    """Upsert a match and its participants with fully_analyzed=True.

    Uses SQLAlchemy merge (upsert) to handle both insert and update cases.
    Creates skeletal Player records for FK satisfaction if missing and stores
    objective timeline aggregates when timeline payload is available.
    """
    from app.features.matches.transformers import MatchDTOTransformer

    platform_id = match_dto.info.platform or "EUN1"
    match_id = match_dto.metadata.match_id

    early_surrender = any(
        p.game_ended_in_early_surrender for p in match_dto.info.participants
    )
    surrender = any(p.game_ended_in_surrender for p in match_dto.info.participants)

    try:
        match = Match(
            match_id=match_id,
            platform=platform_id.upper(),
            game_start_timestamp=match_dto.info.game_start_timestamp,
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
            fully_analyzed=True,
        )
        await db.merge(match)

        for participant in match_dto.info.participants:
            p_game_name = (
                participant.game_name or participant.summoner_name or "Unknown"
            )
            p_tag_line = participant.tag_line or (
                platform_id.replace("1", "") if platform_id else "RIOT"
            )
            if not p_game_name or p_game_name == "":
                p_game_name = "Unknown"
            if not p_tag_line or p_tag_line == "":
                p_tag_line = "RIOT"

            existing_player_result = await db.execute(
                select(Player).where(Player.puuid == participant.puuid)
            )
            existing_player = existing_player_result.scalar_one_or_none()

            player_record = Player(
                puuid=participant.puuid,
                game_name=p_game_name,
                tag_line=p_tag_line,
                platform=platform_id.lower(),
                profile_icon_id=participant.profile_icon or 29,
                summoner_level=participant.summoner_level or 0,
                is_tracked=existing_player.is_tracked if existing_player else False,
            )
            await db.merge(player_record)

            participant_data = MatchDTOTransformer.extract_participant_data(participant)
            match_participant = MatchParticipant(
                match_id=match_id,
                **participant_data,
            )
            await db.merge(match_participant)

        await replace_match_timeline_rows(db, match_dto, timeline_payload)

        await db.commit()

    except Exception as e:
        logger.error(
            "Failed to upsert match",
            match_id=match_id,
            error=str(e),
        )
        try:
            await db.rollback()
        except Exception:
            pass
        raise
