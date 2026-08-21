"""The skeletal player row a match write creates, and what it must not clobber.

Every participant of every stored match becomes a `core.players` row so the
participant FK resolves. Two writers create the same bystander rows at once --
the Match Fetcher and the matchmaking worker, on separate sessions -- so the
statement has to settle the collision itself.
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

    IntegrityError is a SQLAlchemyError, and `must_abort_writer_sync`
    escalates those past the per-match handler -- so a bystander participant
    created by another writer meant every remaining tracked player in the pass
    was skipped.
    """
    compiled = _compiled(_participant())

    assert "INSERT INTO core.players" in compiled
    assert "ON CONFLICT (puuid) DO UPDATE" in compiled


def test_the_conflict_clause_never_writes_is_tracked() -> None:
    """Tracking is not this writer's to answer.

    The value would come from a read taken moments earlier, which is exactly
    how a concurrent track or untrack gets lost.
    """
    conflict_clause = _compiled(_participant()).split("ON CONFLICT")[1]

    assert "is_tracked" not in conflict_clause


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
