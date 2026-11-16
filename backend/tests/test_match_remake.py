"""Where a participant's remake flag comes from (LGA-132), without a database.

`upsert_match` is driven against a session that records what it is asked to
store, so the derivation is pinned in the default tier as well as in
`tests/integration/test_remake_derivation.py`, which needs PostgreSQL.
"""

import json
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import AsyncMock

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.riot_api.models import MatchDTO
from app.features.matches.match_persistence import upsert_match
from app.features.matches.models import Match
from app.features.matches.participants import MatchParticipant

FIXTURE: dict[str, Any] = json.loads(
    (Path(__file__).parent / "fixtures" / "riot_contracts_2026_08_08.json").read_text()
)


def _match(result: str, participants: list[dict[str, Any]]) -> MatchDTO:
    """The recorded Solo/Duo match with ten participants and an end result."""
    payload: dict[str, Any] = deepcopy(FIXTURE["matches"]["420"])
    payload.pop("timeline")
    payload["info"]["endOfGameResult"] = result
    payload["info"]["participants"] = [
        {**deepcopy(FIXTURE["participant"]), "participantId": slot, **flags}
        | {"puuid": f"puuid-{slot}"}
        for slot, flags in enumerate(participants, start=1)
    ]
    return MatchDTO.model_validate(payload)


async def _stored(match: MatchDTO) -> tuple[Match, list[MatchParticipant]]:
    """Run the real writer and return the rows it handed to the session."""
    merged: list[object] = []

    async def merge(row: object) -> object:
        merged.append(row)
        return row

    session = SimpleNamespace(
        merge=merge, execute=AsyncMock(), commit=AsyncMock(), rollback=AsyncMock()
    )
    await upsert_match(cast(AsyncSession, session), match)
    (match_row,) = [row for row in merged if isinstance(row, Match)]
    return match_row, [row for row in merged if isinstance(row, MatchParticipant)]


async def test_a_completed_game_stores_no_remake_for_an_ineligible_participant() -> (
    None
):
    """Riot clears `eligibleForProgression` for single players in full games.

    One of ten here, as in the payload on the ticket. Read as the remake flag,
    it greyed that player's row out and dropped the game from their analyses.
    """
    finished = {"gameEndedInEarlySurrender": False, "gameEndedInSurrender": False}
    participants = [dict(finished) for _ in range(10)]
    participants[1]["eligibleForProgression"] = False

    match_row, rows = await _stored(_match("GameComplete", participants))

    assert match_row.early_surrender is False
    assert [row.remake for row in rows] == [False] * 10


async def test_an_early_surrender_stores_a_remake_for_all_ten() -> None:
    """The match decides, including for a participant whose own flag is absent."""
    participants: list[dict[str, Any]] = [
        {"gameEndedInEarlySurrender": True} for _ in range(9)
    ]
    participants.append({"eligibleForProgression": True})

    match_row, rows = await _stored(_match("Abort_TooFewPlayers", participants))

    assert match_row.early_surrender is True
    assert [row.remake for row in rows] == [True] * 10


async def test_an_ordinary_surrender_is_not_a_remake() -> None:
    # The neighbouring flag: a 15-minute forfeit is a real loss, and storing
    # `surrender` in `remake`'s place would void every one of them.
    participants = [
        {"gameEndedInEarlySurrender": False, "gameEndedInSurrender": True}
        for _ in range(10)
    ]

    match_row, rows = await _stored(_match("GameComplete", participants))

    assert match_row.surrender is True
    assert [row.remake for row in rows] == [False] * 10
