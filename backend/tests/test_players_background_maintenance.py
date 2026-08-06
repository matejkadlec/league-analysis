"""Direct player-add writer maintenance regressions."""

from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import BackgroundTasks, HTTPException

from app.features.jobs.maintenance import (
    RIOT_MAINTENANCE_MODE_KEY,
    RIOT_WRITER_TABLES,
)
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
        def scalars(self):
            return SimpleNamespace(all=lambda: [job_config])

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

    assert str(session.statements[0]) == (
        f"LOCK TABLE {', '.join(RIOT_WRITER_TABLES)} IN ROW EXCLUSIVE MODE"
    )
    assert getattr(session.statements[1], "_for_update_arg") is not None
    riot_client_factory.assert_not_called()


@pytest.mark.asyncio
async def test_player_add_blocks_core_and_auth_writes_during_maintenance(
    monkeypatch,
) -> None:
    """The foreground route checks the interlock before player persistence."""
    player_service = SimpleNamespace(db=object(), add_and_track_player=AsyncMock())
    monkeypatch.setattr(
        players_router,
        "_riot_writer_maintenance_is_active",
        AsyncMock(return_value=True),
    )

    with pytest.raises(HTTPException) as error:
        await players_router.add_tracked_player(
            player_service=player_service,
            riot_client=object(),
            background_tasks=BackgroundTasks(),
            current_user=SimpleNamespace(id=7),
            game_name="Player",
            tag_line="TAG",
            platform="eun1",
        )

    assert error.value.status_code == 503
    player_service.add_and_track_player.assert_not_awaited()


@pytest.mark.asyncio
async def test_player_add_continues_when_maintenance_is_inactive(monkeypatch) -> None:
    """The maintenance guard does not block normal tracked-player creation."""
    response = SimpleNamespace(puuid="test-puuid", platform="eun1")
    player_service = SimpleNamespace(
        db=object(),
        add_and_track_player=AsyncMock(return_value=response),
    )
    monkeypatch.setattr(
        players_router,
        "_riot_writer_maintenance_is_active",
        AsyncMock(return_value=False),
    )
    background_tasks = BackgroundTasks()

    result = await players_router.add_tracked_player(
        player_service=player_service,
        riot_client=object(),
        background_tasks=background_tasks,
        current_user=SimpleNamespace(id=7),
        game_name="Player",
        tag_line="TAG",
        platform="eun1",
    )

    assert result is response
    player_service.add_and_track_player.assert_awaited_once()
    assert len(background_tasks.tasks) == 2
