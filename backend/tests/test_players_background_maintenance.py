"""Player tracking and maintenance-interlock regressions."""

from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import Select, Update
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from app.core.riot_api.client import RiotAPIClient
from app.core.riot_api.models import MatchDTO
from app.features.auth.models import User
from app.features.jobs.maintenance import RiotWriterMaintenanceActiveError
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


async def test_the_global_tracking_recount_locks_the_row_it_rewrites() -> None:
    """Count-then-write on one PUUID is only safe while the row is held.

    Two users acting on one player interleaved there: the untrack counted
    zero without seeing the other's uncommitted track, then wrote its stale
    `false` last. The mapping table then said the player was tracked while
    `core.players.is_tracked` -- the allowlist both writer jobs load -- said
    nobody tracked them, and nothing but another track or untrack clears it.
    """
    statements: list[object] = []

    class _Session:
        async def execute(self, statement: object) -> SimpleNamespace:
            statements.append(statement)
            return SimpleNamespace(scalar=lambda: 1)

    service = PlayerService(cast(AsyncSession, _Session()))

    assert await service._update_global_tracking_flag("puuid-1") is True

    lock = statements[0]
    assert isinstance(lock, Select)
    assert lock._for_update_arg is not None
    # Ordering is the whole fix: a lock taken after the count locks nothing.
    assert isinstance(statements[1], Select)
    assert isinstance(statements[2], Update)


async def test_tracking_a_player_starts_one_initial_sync(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Tracking claims the same PlayerSyncRun lifecycle as the Update button.

    Without it a newly tracked player shows nothing until the Match Fetcher's
    next pass, which is a runtime setting measured in minutes, not seconds.
    """
    response = SimpleNamespace(puuid="test-puuid", platform="eun1")
    player_service = SimpleNamespace(
        db=object(),
        track_player=AsyncMock(return_value=response),
    )
    claim = AsyncMock(return_value=(SimpleNamespace(id=11), True))
    monkeypatch.setattr(players_router, "create_or_get_player_sync", claim)
    background_tasks = BackgroundTasks()

    result = await players_router.track_player(
        request=_request(),
        puuid="test-puuid",
        player_service=cast(PlayerService, player_service),
        background_tasks=background_tasks,
        current_user=cast(User, SimpleNamespace(id=7)),
    )

    assert result is response
    claim.assert_awaited_once_with(player_service.db, user_id=7, puuid="test-puuid")
    assert len(background_tasks.tasks) == 1
    assert background_tasks.tasks[0].func is players_router.run_player_sync
    assert background_tasks.tasks[0].args == (11,)


async def test_tracking_an_already_syncing_player_queues_no_second_task(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Attaching to a running update must not start a second orchestrator."""
    player_service = SimpleNamespace(
        db=object(),
        track_player=AsyncMock(return_value=SimpleNamespace(puuid="test-puuid")),
    )
    monkeypatch.setattr(
        players_router,
        "create_or_get_player_sync",
        AsyncMock(return_value=(SimpleNamespace(id=11), False)),
    )
    background_tasks = BackgroundTasks()

    await players_router.track_player(
        request=_request(),
        puuid="test-puuid",
        player_service=cast(PlayerService, player_service),
        background_tasks=background_tasks,
        current_user=cast(User, SimpleNamespace(id=7)),
    )

    assert not background_tasks.tasks


async def test_tracking_blocks_and_starts_nothing_during_maintenance(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The interlock has to stop the sync as well as the tracking write."""
    player_service = SimpleNamespace(
        db=object(),
        track_player=AsyncMock(side_effect=RiotWriterMaintenanceActiveError()),
    )
    claim = AsyncMock()
    monkeypatch.setattr(players_router, "create_or_get_player_sync", claim)
    background_tasks = BackgroundTasks()

    with pytest.raises(HTTPException) as error:
        await players_router.track_player(
            request=_request(),
            puuid="test-puuid",
            player_service=cast(PlayerService, player_service),
            background_tasks=background_tasks,
            current_user=cast(User, SimpleNamespace(id=7)),
        )

    assert error.value.status_code == 503
    claim.assert_not_awaited()
    assert not background_tasks.tasks


async def test_a_failed_sync_claim_still_reports_the_player_as_tracked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The tracking write is already committed when the claim runs.

    Reporting 500 here would tell the client the player was not tracked while
    the row exists, so the toast would contradict the sidebar. The sync is
    only an optimisation over the scheduler's next pass.
    """
    response = SimpleNamespace(puuid="test-puuid", platform="eun1")
    player_service = SimpleNamespace(
        db=object(),
        track_player=AsyncMock(return_value=response),
    )
    monkeypatch.setattr(
        players_router,
        "create_or_get_player_sync",
        AsyncMock(side_effect=RuntimeError("claim exploded")),
    )
    background_tasks = BackgroundTasks()

    result = await players_router.track_player(
        request=_request(),
        puuid="test-puuid",
        player_service=cast(PlayerService, player_service),
        background_tasks=background_tasks,
        current_user=cast(User, SimpleNamespace(id=7)),
    )

    assert result is response
    assert not background_tasks.tasks


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
        await service._reprocess_match(cast(MatchDTO, SimpleNamespace()))

    guard.assert_awaited_once()
