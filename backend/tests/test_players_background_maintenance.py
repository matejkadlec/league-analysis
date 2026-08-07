"""Direct player-add writer maintenance regressions."""

from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import BackgroundTasks, HTTPException
from starlette.requests import Request

from app.features.auth import router as auth_router
from app.features.jobs.maintenance import (
    RIOT_MAINTENANCE_MODE_KEY,
    RIOT_WRITER_TABLES,
    RiotWriterMaintenanceActiveError,
)
from app.features.jobs.models import JobType
from app.features.matches import router as matches_router
from app.features.matches import service as matches_service_module
from app.features.matches.service import MatchService
from app.features.players import router as players_router
from app.features.players import service as players_service_module
from app.features.players.service import PlayerService


def _request() -> Request:
    """Build the minimal request required by rate-limited route wrappers."""
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/",
            "headers": [],
            "client": ("127.0.0.1", 12345),
        }
    )


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


@pytest.mark.asyncio
async def test_account_link_uses_the_shared_writer_guard(monkeypatch) -> None:
    """Account linking cannot create tracked data after cleanup enables its lock."""
    guard = AsyncMock(side_effect=RiotWriterMaintenanceActiveError())
    monkeypatch.setattr(
        players_service_module,
        "_ensure_riot_writer_maintenance_is_inactive",
        guard,
    )
    riot_client = SimpleNamespace(get_account_by_riot_id=AsyncMock())

    with pytest.raises(HTTPException) as error:
        await auth_router.connect_riot_account(
            request=object(),
            link_request=SimpleNamespace(
                game_name="Player", tag_line="TAG", platform="eun1"
            ),
            riot_client=riot_client,
            current_user=SimpleNamespace(id=7),
            auth_service=SimpleNamespace(db=object()),
        )

    assert error.value.status_code == 503
    guard.assert_awaited_once()
    riot_client.get_account_by_riot_id.assert_not_awaited()


@pytest.mark.asyncio
async def test_player_refresh_uses_the_shared_writer_guard(monkeypatch) -> None:
    """Profile and league refreshes cannot repopulate cleanup-owned rows."""
    guard = AsyncMock(side_effect=RiotWriterMaintenanceActiveError())
    monkeypatch.setattr(
        players_service_module,
        "_ensure_riot_writer_maintenance_is_inactive",
        guard,
    )
    database = SimpleNamespace(
        get=AsyncMock(return_value=SimpleNamespace(puuid="test-puuid", platform="eun1"))
    )
    player_service = PlayerService(database)  # type: ignore[arg-type]

    with pytest.raises(HTTPException) as error:
        await players_router.refresh_player_league(
            request=_request(),
            puuid="test-puuid",
            player_service=player_service,
            riot_client=object(),
            _current_user=SimpleNamespace(id=7),
            queue_type="RANKED_SOLO_5x5",
        )

    assert error.value.status_code == 503
    guard.assert_awaited_once()


@pytest.mark.asyncio
async def test_match_history_start_refuses_active_maintenance(monkeypatch) -> None:
    """No match-history task is queued while cleanup owns gameplay tables."""
    from app.features.jobs import maintenance

    monkeypatch.setattr(
        maintenance,
        "ensure_riot_writer_maintenance_is_inactive",
        AsyncMock(side_effect=RiotWriterMaintenanceActiveError()),
    )
    background_tasks = BackgroundTasks()

    with pytest.raises(HTTPException) as error:
        await matches_router.analyze_match_history(
            request=_request(),
            puuid="test-puuid",
            background_tasks=background_tasks,
            db=object(),
            current_user=SimpleNamespace(id=7),
        )

    assert error.value.status_code == 503
    assert not background_tasks.tasks


@pytest.mark.asyncio
async def test_match_storage_rechecks_maintenance_before_each_write(
    monkeypatch,
) -> None:
    """A task scheduled before cleanup cannot write a later fetched match."""
    guard = AsyncMock(side_effect=RiotWriterMaintenanceActiveError())
    monkeypatch.setattr(
        matches_service_module,
        "_ensure_riot_writer_maintenance_is_inactive",
        guard,
    )
    service = MatchService(object())  # type: ignore[arg-type]

    with pytest.raises(RiotWriterMaintenanceActiveError):
        await service.store_match_from_dto(SimpleNamespace())

    guard.assert_awaited_once()
