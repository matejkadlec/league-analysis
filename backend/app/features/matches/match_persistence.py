"""Persist Riot match DTOs and reprocess stored match rows."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.riot_api.models import MatchDTO, ParticipantDTO
from app.features.players.identity import resolve_player_display_fields
from app.features.players.models import Player

from .match_lp import initialize_participant_lp
from .models import Match
from .participants import MatchParticipant


def extract_store_participant_identity(participant: ParticipantDTO) -> dict[str, Any]:
    """Normalize a match DTO participant into the player-row identity fields."""
    game_name = participant.game_name or participant.summoner_name or "Unknown"
    tag_line = participant.tag_line
    if not tag_line and "#" in game_name:
        game_name, tag_line = game_name.split("#", 1)
    return {
        "puuid": participant.puuid,
        "game_name": game_name,
        "tag_line": tag_line or "RIOT",
        "summoner_level": participant.summoner_level,
        "profile_icon_id": getattr(participant, "profile_icon", 29),
    }


def match_end_flags(participants: Iterable[ParticipantDTO]) -> tuple[bool, bool]:
    """Derive early-surrender and surrender flags from participant DTOs."""
    early_surrender = any(
        participant.game_ended_in_early_surrender for participant in participants
    )
    surrender = any(participant.game_ended_in_surrender for participant in participants)
    return early_surrender, surrender


def match_dto_id(match_dto: MatchDTO) -> str:
    if hasattr(match_dto, "metadata"):
        return match_dto.metadata.match_id
    return "unknown"


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
    )
    if fully_analyzed is not None:
        match.fully_analyzed = fully_analyzed
    return match


def add_participants_from_dto(session: AsyncSession, match_dto: MatchDTO) -> None:
    """Stage MatchParticipant rows from a Riot match DTO."""
    from .transformers import MatchDTOTransformer

    for participant in match_dto.info.participants:
        participant_data = MatchDTOTransformer.extract_participant_data(participant)
        participant_model = MatchParticipant(
            match_id=match_dto.metadata.match_id,
            **participant_data,
        )
        initialize_participant_lp(
            participant_model,
            queue_id=match_dto.info.queue_id,
            remake=participant_data["remake"],
        )
        session.add(participant_model)


def resolve_reprocess_player_fields(
    participant: ParticipantDTO,
    existing_player: Player | None,
    platform_id: str,
) -> dict[str, Any]:
    """Preserve known identity fields when a Riot participant payload is incomplete."""
    return resolve_player_display_fields(participant, existing_player, platform_id)


async def merge_reprocess_player(
    session: AsyncSession,
    participant: ParticipantDTO,
    platform_id: str,
) -> None:
    """Upsert the skeletal player row required by the match-participant FK."""
    existing_player_result = await session.execute(
        select(Player).where(Player.puuid == participant.puuid)
    )
    existing_player = existing_player_result.scalar_one_or_none()
    fields = resolve_reprocess_player_fields(participant, existing_player, platform_id)
    await session.merge(
        Player(
            puuid=participant.puuid,
            game_name=fields["game_name"],
            tag_line=fields["tag_line"],
            platform=platform_id.lower(),
            profile_icon_id=fields["profile_icon_id"],
            summoner_level=fields["summoner_level"],
            is_tracked=fields["is_tracked"],
        )
    )


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
