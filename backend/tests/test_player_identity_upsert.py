"""The skeletal player row a match write creates, and what it must not clobber.

Every participant of every stored match becomes a `core.players` row so the
participant FK resolves. The Match Fetcher and the matchmaking worker create
the same bystander rows at once, so the statement settles the collision.
"""

import json
from copy import deepcopy
from pathlib import Path
from typing import Any

from sqlalchemy.dialects import postgresql

from app.core.riot_api.models import ParticipantDTO
from app.features.players.identity import upsert_player_statement

FIXTURE: dict[str, Any] = json.loads(
    (Path(__file__).parent / "fixtures" / "riot_contracts_2026_08_08.json").read_text()
)


def _participant(**overrides: object) -> ParticipantDTO:
    payload = deepcopy(FIXTURE["participant"])
    payload.update(overrides)
    return ParticipantDTO.model_validate(payload)


def _compiled(participant: ParticipantDTO) -> str:
    return str(
        upsert_player_statement(participant, "EUN1").compile(
            dialect=postgresql.dialect()
        )
    )


def test_a_colliding_participant_updates_instead_of_raising() -> None:
    """A select-then-insert made one PK collision fail the whole job run.

    A bystander participant created by another writer used to skip every
    remaining tracked player in the pass. Settling the collision in the
    conflict clause writes the row rather than skipping it.
    """
    compiled = _compiled(_participant())

    assert "INSERT INTO core.players" in compiled
    assert "ON CONFLICT (puuid) DO UPDATE" in compiled


def test_the_conflict_clause_never_writes_the_tracking_flag() -> None:
    """Tracking is not this writer's to answer.

    The value would come from a read taken moments earlier, which is exactly
    how a concurrent track or untrack gets lost.
    """
    conflict_clause = _compiled(_participant()).split("ON CONFLICT")[1]

    assert "is_tracked_by_anyone" not in conflict_clause


def test_a_named_participant_overwrites_the_stored_name() -> None:
    conflict_clause = _compiled(_participant()).split("ON CONFLICT")[1]

    assert "game_name = excluded.game_name" in conflict_clause


def test_a_participant_without_a_name_keeps_the_stored_one() -> None:
    """Riot omits identity fields from older payloads.

    Letting the placeholder win there renames a known player to "Unknown".
    """
    conflict_clause = _compiled(
        _participant(riotIdGameName=None, riotIdTagline=None)
    ).split("ON CONFLICT")[1]

    assert "coalesce(nullif(core.players.game_name" in conflict_clause.lower()
    assert "coalesce(nullif(core.players.tag_line" in conflict_clause.lower()


def test_the_conflict_clause_moves_updated_at() -> None:
    """A Core ON CONFLICT never fires the ORM-level `onupdate`."""
    conflict_clause = _compiled(_participant()).split("ON CONFLICT")[1]

    assert "updated_at = now()" in conflict_clause
