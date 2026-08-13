"""Global match storage utilities.

Provides a single entry point for ensuring matches are fully analyzed in DB.
Any component that needs a fully-analyzed match should use `ensure_match_fully_analyzed`
instead of implementing its own storage logic. This handles:
- Matches not yet in DB → fetch from API and store with fully_analyzed=True
- Matches in DB with fully_analyzed=False → re-fetch from API and update
- Matches in DB with fully_analyzed=True → no-op (already complete)
- Timeline objective aggregates are fetched and stored when available
"""

from typing import TYPE_CHECKING, Any, Optional

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


def _coalesce(*values: Any) -> Any:
    """Return the first truthy value, or the last argument when all are falsy."""
    for value in values[:-1]:
        if value:
            return value
    return values[-1]


def _existing_player_attr(existing_player: Player | None, attr: str) -> Any:
    """Read one stored player field, or None when the row is missing."""
    return getattr(existing_player, attr) if existing_player else None


def _participant_display_fields(
    participant: Any, existing_player: Player | None, platform_id: str
) -> tuple[str, str, int, int, bool]:
    """Resolve display fields for a skeletal player upsert."""
    game_name = _coalesce(
        participant.game_name,
        _existing_player_attr(existing_player, "game_name"),
        participant.summoner_name,
        "Unknown",
    )
    platform_tag = platform_id.replace("1", "") if platform_id else "RIOT"
    tag_line = _coalesce(
        participant.tag_line,
        _existing_player_attr(existing_player, "tag_line"),
        platform_tag,
    )
    profile_icon_id = _coalesce(
        participant.profile_icon,
        _existing_player_attr(existing_player, "profile_icon_id"),
        29,
    )
    summoner_level = _coalesce(
        participant.summoner_level,
        _existing_player_attr(existing_player, "summoner_level"),
        0,
    )
    is_tracked = existing_player.is_tracked if existing_player else False
    return game_name, tag_line, profile_icon_id, summoner_level, is_tracked


def _build_fully_analyzed_match(match_dto: Any) -> Match:
    """Build a fully-analyzed match row from a Riot match DTO."""
    platform_id = match_dto.info.platform or "EUN1"
    early_surrender = any(
        participant.game_ended_in_early_surrender
        for participant in match_dto.info.participants
    )
    surrender = any(
        participant.game_ended_in_surrender
        for participant in match_dto.info.participants
    )
    return Match(
        match_id=match_dto.metadata.match_id,
        platform=platform_id.upper(),
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
        fully_analyzed=True,
    )


async def _upsert_match_participant(
    db: AsyncSession,
    match_id: str,
    participant: Any,
    platform_id: str,
) -> None:
    """Merge the participant's skeletal player row and match participant row."""
    from app.features.matches.transformers import MatchDTOTransformer

    existing_player_result = await db.execute(
        select(Player).where(Player.puuid == participant.puuid)
    )
    existing_player = existing_player_result.scalar_one_or_none()
    game_name, tag_line, profile_icon_id, summoner_level, is_tracked = (
        _participant_display_fields(participant, existing_player, platform_id)
    )
    await db.merge(
        Player(
            puuid=participant.puuid,
            game_name=game_name,
            tag_line=tag_line,
            platform=platform_id.lower(),
            profile_icon_id=profile_icon_id,
            summoner_level=summoner_level,
            is_tracked=is_tracked,
        )
    )
    participant_data = MatchDTOTransformer.extract_participant_data(participant)
    await db.merge(MatchParticipant(match_id=match_id, **participant_data))


async def _rollback_quietly(db: AsyncSession) -> None:
    """Roll back the current transaction, ignoring rollback failures."""
    try:
        await db.rollback()
    except Exception:
        pass


async def _upsert_match(
    db: AsyncSession,
    match_dto: Any,
    timeline_payload: Optional[dict] = None,
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
            await _upsert_match_participant(db, match_id, participant, platform_id)
        await replace_match_timeline_rows(db, match_dto, timeline_payload)
        await db.commit()
    except Exception as e:
        logger.error(
            "Failed to upsert match",
            match_id=match_id,
            error=str(e),
        )
        await _rollback_quietly(db)
        raise
