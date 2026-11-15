"""A remake is a fact about the match, read back through the real writer.

Rank Manipulation's eligibility exists only in SQL, and the Match History row
is built from the stored participant, so both are asserted on what
`upsert_match` actually leaves in PostgreSQL.
"""

from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.riot_api.models import MatchDTO
from app.features.auth.users.models import User
from app.features.matches.match_history import build_player_match_participant
from app.features.matches.match_lp import LP_SOURCE_REMAKE, LP_SOURCE_UNAVAILABLE
from app.features.matches.match_persistence import upsert_match
from app.features.matches.models import Match
from app.features.matches.participants import MatchParticipant
from app.features.smurf_boost_detection.service import SmurfBoostDetectionService

pytestmark = [pytest.mark.integration, pytest.mark.enable_socket]

FIXTURE: dict[str, Any] = json.loads(
    (
        Path(__file__).parents[1] / "fixtures" / "riot_contracts_2026_08_08.json"
    ).read_text()
)

PLAYER_PUUID = "REMAKE-DERIVATION-PLAYER-".ljust(78, "0")
OTHER_PUUID = "REMAKE-DERIVATION-OTHER-".ljust(78, "0")


def _match(
    match_id: str, *, duration: int, participants: list[dict[str, Any]]
) -> MatchDTO:
    """The recorded Solo/Duo match, with its participants replaced."""
    payload: dict[str, Any] = deepcopy(FIXTURE["matches"]["420"])
    payload.pop("timeline")
    payload["metadata"]["matchId"] = match_id
    payload["metadata"]["participants"] = [row["puuid"] for row in participants]
    payload["info"]["gameDuration"] = duration
    payload["info"]["participants"] = participants
    return MatchDTO.model_validate(payload)


def _participant(slot: int, puuid: str, **flags: object) -> dict[str, Any]:
    """The recorded participant in a lane Rank Manipulation recognises."""
    payload: dict[str, Any] = deepcopy(FIXTURE["participant"])
    payload.update(
        {"participantId": slot, "puuid": puuid, "teamPosition": "TOP", **flags}
    )
    return payload


async def _stored_participants(
    session: AsyncSession, match_id: str
) -> list[MatchParticipant]:
    session.expire_all()
    result = await session.execute(
        select(MatchParticipant)
        .where(MatchParticipant.match_id == match_id)
        .order_by(MatchParticipant.participant_id)
    )
    return list(result.scalars().all())


async def test_a_completed_game_is_no_remake_whatever_riot_says_of_progression(
    database_session: AsyncSession, stored_user: User
) -> None:
    """`eligibleForProgression: false` in a `GameComplete` match changes nothing.

    Riot clears that flag for individual players in full-length games (LGA-132).
    Read as the remake flag, it greyed the row out in Match History, zeroed its
    LP and dropped the game from Rank Manipulation.
    """
    match_id = "EUN1_REMAKE_NONE"
    # Read before the writer commits: a commit expires the loaded account.
    user_id = stored_user.id
    await upsert_match(
        database_session,
        _match(
            match_id,
            duration=1859,
            participants=[
                _participant(
                    1,
                    PLAYER_PUUID,
                    eligibleForProgression=False,
                    gameEndedInEarlySurrender=False,
                    gameEndedInSurrender=False,
                )
            ],
        ),
    )

    (stored,) = await _stored_participants(database_session, match_id)
    assert stored.remake is False
    history_row = build_player_match_participant(stored)
    assert history_row is not None
    assert history_row.remake is False
    assert (stored.lp_change, stored.lp_change_source) == (None, LP_SOURCE_UNAVAILABLE)
    service = SmurfBoostDetectionService(database_session, user_id)
    assert await service._count_eligible(PLAYER_PUUID) == 1


async def test_an_early_surrender_marks_every_participant_a_remake(
    database_session: AsyncSession,
) -> None:
    """One participant's flag settles it for the whole match.

    The second participant says nothing either way and is eligible for
    progression; under the old derivation their row was an ordinary game.
    """
    match_id = "EUN1_REMAKE_REAL"
    await upsert_match(
        database_session,
        _match(
            match_id,
            duration=190,
            participants=[
                _participant(1, PLAYER_PUUID, gameEndedInEarlySurrender=True),
                _participant(2, OTHER_PUUID, eligibleForProgression=True),
            ],
        ),
    )

    stored = await _stored_participants(database_session, match_id)
    assert [row.remake for row in stored] == [True, True]
    assert {(row.lp_change, row.lp_change_source) for row in stored} == {
        (0, LP_SOURCE_REMAKE)
    }
    early_surrender = await database_session.scalar(
        select(Match.early_surrender).where(Match.match_id == match_id)
    )
    assert early_surrender is True
