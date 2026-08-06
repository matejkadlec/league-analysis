"""Direct player-add writer maintenance regressions."""

from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from app.features.jobs.maintenance import RIOT_MAINTENANCE_MODE_KEY
from app.features.jobs.models import JobType
from app.features.players import router as players_router


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("runner", "job_type"),
    [
        (players_router.run_background_match_sync, JobType.MATCH_FETCHER),
        (players_router.run_background_player_update, JobType.PLAYER_UPDATER),
    ],
)
async def test_player_add_writers_lock_and_honor_the_cleanup_interlock(
    monkeypatch, runner, job_type: JobType
) -> None:
    """Direct writers wait for cleanup's configuration update before Riot writes."""
    job_config = SimpleNamespace(
        job_type=job_type,
        config_json={RIOT_MAINTENANCE_MODE_KEY: True},
    )

    class Result:
        def scalar_one_or_none(self):
            return job_config

    class Session:
        def __init__(self) -> None:
            self.statements: list[object] = []

        async def execute(self, statement: object) -> Result:
            self.statements.append(statement)
            return Result()

    session = Session()

    @asynccontextmanager
    async def fake_get_session():
        yield session

    riot_client_factory = Mock()
    monkeypatch.setattr(players_router.db_manager, "get_session", fake_get_session)
    monkeypatch.setattr(players_router, "RiotAPIClient", riot_client_factory)

    await runner("test-puuid", "eun1")

    assert getattr(session.statements[0], "_for_update_arg") is not None
    riot_client_factory.assert_not_called()
