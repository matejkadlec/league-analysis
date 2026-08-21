"""The identity-fallback policy for the skeletal player rows a match creates."""

from typing import Any

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import Insert, insert

from app.core.riot_api.constants import normalize_platform
from app.core.riot_api.models import ParticipantDTO
from app.features.players.models import Player


def first_present[T](*values: T | None, default: T) -> T:
    """Return the first truthy value, otherwise ``default``."""
    for value in values:
        if value:
            return value
    return default


# Per column: the stored value that means "nothing known yet". Riot omits
# identity fields from older match payloads, so a row written from one must
# not overwrite a real name with a placeholder.
_UNSET: dict[str, Any] = {
    "game_name": "",
    "tag_line": "",
    "profile_icon_id": 0,
    "summoner_level": 0,
}


def upsert_player_statement(
    participant: ParticipantDTO,
    platform_id: str,
) -> Insert:
    """Build the INSERT ... ON CONFLICT that satisfies the participant FK.

    The precedence is unchanged -- the participant's own field, else whatever
    is already stored, else a placeholder -- but it is expressed in the
    conflict clause rather than in Python over a prior SELECT. That SELECT was
    the race: the matchmaking worker and the Match Fetcher create the same
    bystander player rows on separate sessions, both found nothing, and the
    loser's IntegrityError is a SQLAlchemyError, which `must_abort_writer_sync`
    escalates -- so one primary-key collision on one participant failed the
    entire job run, skipping every remaining tracked player.

    `is_tracked` is deliberately absent from the conflict clause: the stored
    value wins, because writing back a value read moments earlier is how a
    concurrent track or untrack gets lost.
    """
    values: dict[str, Any] = {
        "puuid": participant.puuid,
        "game_name": first_present(
            participant.game_name, participant.summoner_name, default="Unknown"
        ),
        "tag_line": first_present(
            participant.tag_line, default=platform_id.replace("1", "")
        ),
        "platform": normalize_platform(platform_id),
        "profile_icon_id": first_present(participant.profile_icon, default=29),
        "summoner_level": first_present(participant.summoner_level, default=0),
        "is_tracked": False,
    }
    supplied = {
        "game_name": bool(participant.game_name),
        "tag_line": bool(participant.tag_line),
        "profile_icon_id": bool(participant.profile_icon),
        "summoner_level": bool(participant.summoner_level),
    }

    statement = insert(Player).values(**values)
    # `updated_at` carries an ORM-level `onupdate`, which a Core ON CONFLICT
    # never fires.
    updates: dict[str, Any] = {
        "platform": statement.excluded.platform,
        "updated_at": func.now(),
    }
    for column, unset in _UNSET.items():
        updates[column] = (
            statement.excluded[column]
            if supplied[column]
            else func.coalesce(
                func.nullif(getattr(Player, column), unset),
                statement.excluded[column],
            )
        )
    return statement.on_conflict_do_update(index_elements=["puuid"], set_=updates)
