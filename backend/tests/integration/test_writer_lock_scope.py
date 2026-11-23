"""Which writer locks a Riot-data writer holds while it waits on Riot.

The maintenance guard locks the writer rows of `jobs.job_configurations` until
its transaction commits. Only a second connection shows whether a writer
waiting on Riot holds them, so the fake Riot client probes from one.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from types import SimpleNamespace
from typing import cast

import pytest
from sqlalchemy import delete, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.core.riot_api.client import RiotAPIClient
from app.core.riot_api.constants import Platform
from app.features.auth.users.models import User
from app.features.jobs.maintenance import ensure_riot_writer_maintenance_is_inactive
from app.features.jobs.models import JobConfiguration, JobType
from app.features.players.models import Player
from app.features.players.service import PlayerService

pytestmark = [pytest.mark.integration, pytest.mark.enable_socket]

PROBE_LOCK_TIMEOUT = "200ms"
DISCOVERED_PUUID = "DISCOVERED-PUUID-".ljust(78, "0")


@pytest.fixture
async def committed_writer_configurations(
    second_connection_engine: AsyncEngine,
) -> AsyncIterator[None]:
    """The two writer rows the guard locks, committed so both connections see them."""
    async with AsyncSession(second_connection_engine) as session:
        session.add_all(
            [
                JobConfiguration(
                    job_type=job_type,
                    name=f"lock scope {job_type.value}",
                    schedule="3600",
                    is_active=True,
                    config_json={},
                )
                for job_type in (JobType.MATCH_FETCHER, JobType.PLAYER_UPDATER)
            ]
        )
        await session.commit()
    try:
        yield
    finally:
        async with AsyncSession(second_connection_engine) as session:
            await session.execute(
                delete(JobConfiguration).where(
                    JobConfiguration.name.startswith("lock scope ")
                )
            )
            await session.commit()


class _ProbingRiot:
    """A Riot client that, while it is awaited, asks for the writer locks elsewhere."""

    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine
        self.probes: list[str] = []

    async def _probe(self) -> None:
        async with AsyncSession(self._engine) as session:
            await session.execute(
                text(f"SET LOCAL lock_timeout = '{PROBE_LOCK_TIMEOUT}'")
            )
            try:
                await ensure_riot_writer_maintenance_is_inactive(session)
            except DBAPIError:
                self.probes.append("blocked")
            else:
                self.probes.append("acquired")
            await session.rollback()

    async def get_account_by_riot_id(self, *_args: object) -> SimpleNamespace:
        await self._probe()
        return SimpleNamespace(
            puuid=DISCOVERED_PUUID, game_name="Discovered", tag_line="NEW"
        )

    async def get_account_by_puuid(self, *_args: object) -> SimpleNamespace:
        await self._probe()
        return SimpleNamespace(game_name="Renamed", tag_line="NEW")

    async def get_summoner_by_puuid(self, *_args: object) -> SimpleNamespace:
        await self._probe()
        return SimpleNamespace(profile_icon_id=7, summoner_level=99)

    async def get_league_entries_by_puuid(self, *_args: object) -> list[object]:
        await self._probe()
        return []


@pytest.mark.usefixtures("committed_writer_configurations")
@pytest.mark.parametrize(
    ("method", "riot_reads"),
    [
        pytest.param("discover_player", 2, id="discover"),
        pytest.param("update_player_profile", 2, id="profile"),
        pytest.param("update_player_league", 1, id="league"),
    ],
)
async def test_no_interlock_lock_is_held_while_riot_is_awaited(
    database_session: AsyncSession,
    second_connection_engine: AsyncEngine,
    stored_player: Player,
    stored_user: User,
    method: str,
    riot_reads: int,
) -> None:
    """Every other writer can take the interlock while one waits on Riot.

    Held across the await, a slow Riot answer stalled tracking, analysis
    start and job settings application-wide (LGA-127).
    """
    riot = _ProbingRiot(second_connection_engine)
    service = PlayerService(database_session)
    client = cast(RiotAPIClient, riot)

    if method == "discover_player":
        response = await service.discover_player(
            client, "Discovered", "NEW", Platform.EUN1, user_id=stored_user.id
        )
        assert response.puuid == DISCOVERED_PUUID
    elif method == "update_player_profile":
        assert await service.update_player_profile(stored_player, client) is True
        assert stored_player.game_name == "Renamed"
    else:
        assert await service.update_player_league(stored_player, client) is False

    assert riot.probes == ["acquired"] * riot_reads
