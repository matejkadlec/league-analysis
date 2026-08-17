"""Direct player-add background task regressions."""

from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from app.core.riot_api.client import RiotAPIClient
from app.core.riot_api.errors import NotFoundError, RateLimitError
from app.core.riot_api.models import MatchDTO
from app.features.auth.models import User
from app.features.jobs.maintenance import RiotWriterMaintenanceActiveError
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
async def test_player_add_blocks_core_and_auth_writes_during_maintenance(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The foreground route checks the interlock before player persistence."""
    add_and_track_player = AsyncMock()
    player_service = SimpleNamespace(
        db=object(), add_and_track_player=add_and_track_player
    )
    monkeypatch.setattr(
        players_router,
        "_riot_writer_maintenance_is_active",
        AsyncMock(return_value=True),
    )

    with pytest.raises(HTTPException) as error:
        await players_router.add_tracked_player(
            player_service=cast(PlayerService, player_service),
            riot_client=cast(RiotAPIClient, object()),
            background_tasks=BackgroundTasks(),
            current_user=cast(User, SimpleNamespace(id=7)),
            game_name="Player",
            tag_line="TAG",
            platform="eun1",
        )

    assert error.value.status_code == 503
    add_and_track_player.assert_not_awaited()


@pytest.mark.asyncio
async def test_player_add_continues_when_maintenance_is_inactive(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The maintenance guard does not block normal tracked-player creation.

    Onboarding claims the same PlayerSyncRun lifecycle as the Update button,
    so a freshly created run schedules exactly one orchestrator task.
    """
    response = SimpleNamespace(puuid="test-puuid", platform="eun1")
    add_and_track_player = AsyncMock(return_value=response)
    player_service = SimpleNamespace(
        db=object(),
        add_and_track_player=add_and_track_player,
    )
    monkeypatch.setattr(
        players_router,
        "_riot_writer_maintenance_is_active",
        AsyncMock(return_value=False),
    )
    claim = AsyncMock(return_value=(SimpleNamespace(id=11), True))
    monkeypatch.setattr(players_router, "create_or_get_player_sync", claim)
    background_tasks = BackgroundTasks()

    result = await players_router.add_tracked_player(
        player_service=cast(PlayerService, player_service),
        riot_client=cast(RiotAPIClient, object()),
        background_tasks=background_tasks,
        current_user=cast(User, SimpleNamespace(id=7)),
        game_name="Player",
        tag_line="TAG",
        platform="eun1",
    )

    assert result is response
    add_and_track_player.assert_awaited_once()
    claim.assert_awaited_once_with(player_service.db, user_id=7, puuid="test-puuid")
    assert len(background_tasks.tasks) == 1
    assert background_tasks.tasks[0].args == (11,)


@pytest.mark.asyncio
async def test_player_add_returns_not_found_for_a_missing_riot_account(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The client can render a server-specific missing-player message from 404."""
    player_service = SimpleNamespace(
        db=object(),
        add_and_track_player=AsyncMock(
            side_effect=NotFoundError("Resource not found", status_code=404)
        ),
    )
    monkeypatch.setattr(
        players_router,
        "_riot_writer_maintenance_is_active",
        AsyncMock(return_value=False),
    )

    with pytest.raises(HTTPException) as error:
        await players_router.add_tracked_player(
            player_service=cast(PlayerService, player_service),
            riot_client=cast(RiotAPIClient, object()),
            background_tasks=BackgroundTasks(),
            current_user=cast(User, SimpleNamespace(id=7)),
            game_name="SomeName",
            tag_line="1234",
            platform="eun1",
        )

    assert error.value.status_code == 404
    assert error.value.detail == "Player not found"


@pytest.mark.asyncio
async def test_player_add_preserves_the_riot_rate_limit_status(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A live Riot 429 must not be collapsed into a generic server failure."""
    player_service = SimpleNamespace(
        db=object(),
        add_and_track_player=AsyncMock(
            side_effect=RateLimitError(
                "Rate limit exceeded", status_code=429, retry_after=10
            )
        ),
    )
    monkeypatch.setattr(
        players_router,
        "_riot_writer_maintenance_is_active",
        AsyncMock(return_value=False),
    )

    with pytest.raises(HTTPException) as error:
        await players_router.add_tracked_player(
            player_service=cast(PlayerService, player_service),
            riot_client=cast(RiotAPIClient, object()),
            background_tasks=BackgroundTasks(),
            current_user=cast(User, SimpleNamespace(id=7)),
            game_name="SomeName",
            tag_line="1234",
            platform="eun1",
        )

    assert error.value.status_code == 429
    assert error.value.detail == "Riot API rate limit reached"


@pytest.mark.asyncio
async def test_player_refresh_uses_the_shared_writer_guard(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
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
    player_service = PlayerService(cast(AsyncSession, database))

    with pytest.raises(HTTPException) as error:
        await players_router.refresh_player_league(
            request=_request(),
            puuid="test-puuid",
            player_service=player_service,
            riot_client=cast(RiotAPIClient, object()),
            _current_user=cast(User, SimpleNamespace(id=7)),
            queue_type="RANKED_SOLO_5x5",
        )

    assert error.value.status_code == 503
    guard.assert_awaited_once()


@pytest.mark.asyncio
async def test_match_history_start_refuses_active_maintenance(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
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
            db=cast(AsyncSession, object()),
            current_user=cast(User, SimpleNamespace(id=7)),
        )

    assert error.value.status_code == 503
    assert not background_tasks.tasks


@pytest.mark.asyncio
async def test_match_storage_rechecks_maintenance_before_each_write(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A task scheduled before cleanup cannot write a later fetched match."""
    guard = AsyncMock(side_effect=RiotWriterMaintenanceActiveError())
    monkeypatch.setattr(
        matches_service_module,
        "_ensure_riot_writer_maintenance_is_inactive",
        guard,
    )
    service = MatchService(cast(AsyncSession, object()))

    with pytest.raises(RiotWriterMaintenanceActiveError):
        await service.store_match_from_dto(cast(MatchDTO, SimpleNamespace()))

    guard.assert_awaited_once()
