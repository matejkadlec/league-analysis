"""What an `ON CONFLICT` does once a real unique index is behind it.

`index_elements` naming columns no unique index covers compiles cleanly and
raises `InvalidColumnReference` when PostgreSQL plans the statement, so every
test here drives the real writer and reads the row back.
"""

from __future__ import annotations

import json
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.riot_api.credential_health import (
    _HEALTH_ROW_ID,
    RiotCredentialHealth,
    _lock_health_row,
)
from app.core.riot_api.models import ParticipantDTO
from app.features.auth.service import AuthService
from app.features.auth.tokens.revoked_access_token import RevokedAccessToken
from app.features.auth.users.models import User
from app.features.auth.users.user_settings import UserSettings, ensure_user_settings
from app.features.auth.users.user_tracked_player import UserTrackedPlayer
from app.features.players.identity import upsert_player_statement
from app.features.players.models import Player
from app.features.players.service import PlayerService

pytestmark = [pytest.mark.integration, pytest.mark.enable_socket]

FIXTURE: dict[str, Any] = json.loads(
    (
        Path(__file__).parents[1] / "fixtures" / "riot_contracts_2026_08_08.json"
    ).read_text()
)


def _participant(**overrides: object) -> ParticipantDTO:
    """A Riot participant from the recorded contract, with fields replaced."""
    payload = deepcopy(FIXTURE["participant"])
    payload.update(overrides)
    return ParticipantDTO.model_validate(payload)


async def _stored(session: AsyncSession, puuid: str) -> Player:
    """Read a player row straight out of the database, bypassing the identity map."""
    session.expire_all()
    return (
        await session.execute(select(Player).where(Player.puuid == puuid))
    ).scalar_one()


async def test_a_repeat_participant_write_settles_into_one_player_row(
    database_session: AsyncSession, stored_player: Player
) -> None:
    """The second write of a bystander updates instead of raising.

    A select-then-insert lost this race and 500'd on `players_pkey`; the
    conflict target must be the primary key PostgreSQL can actually infer.
    """
    puuid = stored_player.puuid
    participant = _participant(puuid=puuid, riotIdGameName="Renamed")
    await database_session.execute(upsert_player_statement(participant, "EUW1"))
    await database_session.execute(upsert_player_statement(participant, "EUW1"))

    rows = await database_session.execute(
        select(func.count()).select_from(Player).where(Player.puuid == puuid)
    )
    assert rows.scalar_one() == 1
    assert (await _stored(database_session, puuid)).game_name == "Renamed"


async def test_a_participant_without_a_riot_id_keeps_the_stored_one(
    database_session: AsyncSession, stored_player: Player
) -> None:
    """Riot omits identity from older match payloads, and the row must survive it."""
    puuid = stored_player.puuid
    stored_player.game_name = "RealName"
    stored_player.tag_line = "REAL"
    stored_player.summoner_level = 412
    await database_session.flush()

    anonymous = _participant(
        puuid=puuid,
        riotIdGameName=None,
        riotIdTagline=None,
        summonerName=None,
        summonerLevel=0,
    )
    await database_session.execute(upsert_player_statement(anonymous, "EUN1"))

    refreshed = await _stored(database_session, puuid)
    assert (refreshed.game_name, refreshed.tag_line) == ("RealName", "REAL")
    assert refreshed.summoner_level == 412


async def test_the_bystander_write_leaves_a_tracked_player_tracked(
    database_session: AsyncSession, stored_player: Player
) -> None:
    """`is_tracked_by_anyone` is absent from the update set: a stale write loses a track."""
    puuid = stored_player.puuid
    stored_player.is_tracked_by_anyone = True
    await database_session.flush()

    await database_session.execute(
        upsert_player_statement(_participant(puuid=puuid), "EUN1")
    )

    assert (await _stored(database_session, puuid)).is_tracked_by_anyone is True


async def test_the_bystander_write_moves_an_updated_at_no_orm_hook_reaches(
    database_session: AsyncSession, stored_player: Player
) -> None:
    """`updated_at` carries an ORM `onupdate`, which a Core ON CONFLICT never fires.

    The statement therefore sets it by hand, and `created_at` must stay where
    the insert put it.
    """
    puuid = stored_player.puuid
    backdated = datetime(2020, 1, 1, tzinfo=UTC)
    stored_player.created_at = backdated
    stored_player.updated_at = backdated
    await database_session.flush()

    await database_session.execute(
        upsert_player_statement(_participant(puuid=puuid), "EUN1")
    )

    refreshed = await _stored(database_session, puuid)
    transaction_clock = (
        await database_session.execute(select(func.now()))
    ).scalar_one()
    assert refreshed.created_at == backdated
    assert refreshed.updated_at == transaction_clock


async def test_revoking_one_access_token_twice_records_one_revocation(
    database_session: AsyncSession, stored_user: User
) -> None:
    """Two tabs logging out carry the same jti, and `token_id` is the unique column."""
    service = AuthService(database_session)
    access_token, _, token_id = service.create_access_token(stored_user)
    await service.revoke_access_token(access_token)
    await service.revoke_access_token(access_token)

    revocations = await database_session.execute(
        select(func.count())
        .select_from(RevokedAccessToken)
        .where(RevokedAccessToken.token_id == token_id)
    )
    assert revocations.scalar_one() == 1
    assert await service.is_access_token_revoked(token_id) is True


async def test_tracking_a_player_writes_the_row_the_composite_key_covers(
    database_session: AsyncSession, stored_player: Player, stored_user: User
) -> None:
    """One (user, player) pair is one row, and the global flag follows it."""
    puuid = stored_player.puuid
    service = PlayerService(database_session)
    response = await service.track_player(puuid, stored_user.id)

    tracked = await database_session.execute(
        select(func.count())
        .select_from(UserTrackedPlayer)
        .where(UserTrackedPlayer.user_id == stored_user.id)
    )
    assert (response.is_tracked, tracked.scalar_one()) == (True, 1)
    assert (await _stored(database_session, puuid)).is_tracked_by_anyone is True


async def test_the_credential_health_singleton_survives_a_second_creation(
    database_session: AsyncSession,
) -> None:
    """The row is created once; a later locker must not mint a new generation."""
    first = await _lock_health_row(database_session, now=datetime.now(UTC))
    generation = first.generation
    database_session.expire_all()
    second = await _lock_health_row(database_session, now=datetime.now(UTC))

    rows = await database_session.execute(
        select(func.count()).select_from(RiotCredentialHealth)
    )
    assert (second.id, second.generation) == (_HEALTH_ROW_ID, generation)
    assert rows.scalar_one() == 1


async def test_a_new_account_gets_its_settings_row_from_a_database_trigger(
    database_session: AsyncSession, stored_user: User
) -> None:
    """`trg_create_user_settings_after_user_insert` writes the row, not Python.

    `ensure_user_settings` therefore reads a hit on every ordinary account,
    and its `ON CONFLICT DO NOTHING` insert is reached only once the row is
    gone -- which is the path this drives, so the target is still checked.
    """
    written_by_the_trigger = await database_session.scalar(
        select(UserSettings.user_id).where(UserSettings.user_id == stored_user.id)
    )
    await database_session.execute(
        delete(UserSettings).where(UserSettings.user_id == stored_user.id)
    )
    recreated = await ensure_user_settings(database_session, stored_user.id)

    rows = await database_session.execute(
        select(func.count())
        .select_from(UserSettings)
        .where(UserSettings.user_id == stored_user.id)
    )
    assert written_by_the_trigger == stored_user.id
    assert (recreated.user_id, rows.scalar_one()) == (stored_user.id, 1)
