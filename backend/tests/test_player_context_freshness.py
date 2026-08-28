"""Per-user player context and persisted sync-lifecycle regressions."""

from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from app.features.auth.users.models import User
from app.features.jobs import player_sync as player_sync_module
from app.features.jobs.base import BaseJob
from app.features.jobs.models import JobStatus
from app.features.jobs.player_sync import (
    SyncBusyError,
    _failure_from_job,
    create_or_get_player_sync,
)
from app.features.players import router as players_router
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


async def test_current_player_update_is_scoped_to_one_application_user() -> None:
    settings = SimpleNamespace(current_player_puuid=None)
    execute = AsyncMock()
    db = SimpleNamespace(
        scalar=AsyncMock(return_value=settings),
        get=AsyncMock(return_value=SimpleNamespace(puuid="player-puuid")),
        execute=execute,
        add=Mock(),
        flush=AsyncMock(),
        commit=AsyncMock(),
    )
    # The service only ever awaits the session methods stubbed above, so the
    # double stands in for the whole of `AsyncSession` at this one named seam.
    service = PlayerService(cast(AsyncSession, db))
    service.get_player_context = AsyncMock(return_value="context")

    result = await service.set_current_player(7, "player-puuid")

    assert result == "context"
    assert settings.current_player_puuid == "player-puuid"
    assert execute.await_args is not None
    recency_statement = execute.await_args.args[0]
    sql = str(recency_statement)
    assert "auth.user_tracked_players.user_id" in sql
    assert "auth.user_tracked_players.puuid" in sql
    assert 7 in recency_statement.compile().params.values()
    assert "player-puuid" in recency_statement.compile().params.values()
    service.get_player_context.assert_awaited_once_with(7)


async def test_concurrent_explicit_updates_attach_to_the_active_puuid_run() -> None:
    active = SimpleNamespace(id=11, puuid="player-puuid", status="running")
    add = Mock()
    db = SimpleNamespace(
        get=AsyncMock(return_value=SimpleNamespace(puuid="player-puuid")),
        scalar=AsyncMock(return_value=active),
        add=add,
    )

    sync_run, created = await create_or_get_player_sync(
        cast(AsyncSession, db), user_id=7, puuid="player-puuid"
    )

    assert sync_run is active
    assert not created
    add.assert_not_called()


class _FinishedJob:
    """The writer scalars `_failure_from_job` classifies a finished run from.

    A real `BaseJob` would reach for the rolled-back session the mapping exists
    to avoid touching, so the double carries only the cached scalars and the
    two error predicates, cast at the call.
    """

    def __init__(self, *, status: JobStatus) -> None:
        self.job_execution_id = 5
        self.job_execution_status = status
        self.skipped_as_already_running = False

    def has_api_key_error(self) -> bool:
        return False

    def has_puuid_binding_error(self) -> bool:
        return False


@pytest.mark.parametrize(
    ("status", "expected_status", "expected_code"),
    [
        (JobStatus.RATE_LIMITED, "rate_limited", "RIOT_RATE_LIMITED"),
        (JobStatus.CANCELLED, "cancelled", "SYNC_CANCELLED"),
        (JobStatus.FAILED, "failed", "SYNC_FAILED"),
    ],
)
def test_unsuccessful_jobs_map_to_safe_non_success_sync_states(
    status: JobStatus,
    expected_status: str,
    expected_code: str,
) -> None:
    mapped_status, code, message = _failure_from_job(
        cast(BaseJob, _FinishedJob(status=status))
    )

    assert (mapped_status, code) == (expected_status, expected_code)
    assert "secret" not in message.lower()


def _no_active_run_db(
    *,
    other_active: SimpleNamespace | None,
    running_player: SimpleNamespace | None = None,
    writer_configs: list[SimpleNamespace] | None = None,
) -> SimpleNamespace:
    """A session double for a start with no active run for the clicked player.

    `scalar` answers the same-PUUID lookup first and the cross-player lookup
    second; `get` answers the clicked player's row first and, when the busy
    check needs a name, the running player's row second.
    """
    execute = AsyncMock(
        return_value=SimpleNamespace(
            scalars=lambda: SimpleNamespace(all=lambda: writer_configs or [])
        )
    )
    return SimpleNamespace(
        get=AsyncMock(
            side_effect=[SimpleNamespace(puuid="player-puuid"), running_player]
        ),
        scalar=AsyncMock(side_effect=[None, other_active]),
        execute=execute,
        add=Mock(),
    )


async def test_a_start_during_another_players_run_refuses_and_names_them() -> None:
    """No doomed run row: the click is refused up front, naming who is running.

    Before this, the run was created, the job layer skipped it as already
    running, and the click's answer arrived minutes later as a failed run --
    which Match History then reported as "No matches found".
    """
    db = _no_active_run_db(
        other_active=SimpleNamespace(id=11, puuid="other-puuid", status="running"),
        running_player=SimpleNamespace(
            puuid="other-puuid", game_name="Faker", tag_line="KR1"
        ),
    )

    with pytest.raises(SyncBusyError) as error:
        await create_or_get_player_sync(
            cast(AsyncSession, db), user_id=7, puuid="player-puuid"
        )

    assert "Faker#KR1" in error.value.message
    db.add.assert_not_called()


async def test_a_start_during_the_scheduled_fetcher_refuses_up_front(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The 900s scheduled Match Fetcher holds the same runtime key the sync
    writers claim, so a click in its window is refused rather than failed."""
    db = _no_active_run_db(
        other_active=None,
        writer_configs=[SimpleNamespace(id=3), SimpleNamespace(id=4)],
    )

    def running(config_id: int) -> bool:
        return config_id == 4

    monkeypatch.setattr(player_sync_module, "is_runtime_job_running", running)

    with pytest.raises(SyncBusyError) as error:
        await create_or_get_player_sync(
            cast(AsyncSession, db), user_id=7, puuid="player-puuid"
        )

    assert "scheduled" in error.value.message
    db.add.assert_not_called()


async def test_an_idle_pipeline_still_creates_the_run(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = _no_active_run_db(
        other_active=None,
        writer_configs=[SimpleNamespace(id=3)],
    )
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    def idle(config_id: int) -> bool:
        return False

    monkeypatch.setattr(player_sync_module, "is_runtime_job_running", idle)

    sync_run, created = await create_or_get_player_sync(
        cast(AsyncSession, db), user_id=7, puuid="player-puuid"
    )

    assert created
    assert sync_run.puuid == "player-puuid"
    db.add.assert_called_once()


async def test_the_start_endpoint_maps_a_busy_refusal_to_a_structured_409(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The frontend reads `detail.code`, so the refusal must arrive in the
    structured shape `api-error.ts` parses, not as a bare string."""
    monkeypatch.setattr(
        players_router,
        "create_or_get_player_sync",
        AsyncMock(side_effect=SyncBusyError("An update for Faker#KR1 is running.")),
    )
    background_tasks = BackgroundTasks()

    with pytest.raises(HTTPException) as error:
        await players_router.start_player_sync(
            request=_request(),
            puuid="player-puuid",
            background_tasks=background_tasks,
            player_service=cast(PlayerService, SimpleNamespace(db=object())),
            current_user=cast(User, SimpleNamespace(id=7)),
        )

    assert error.value.status_code == 409
    assert error.value.detail == {
        "code": "SYNC_BUSY",
        "message": "An update for Faker#KR1 is running.",
    }
    assert not background_tasks.tasks


async def test_a_failure_before_the_writers_still_terminates_the_run(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Loading the run and stamping it running sit inside the recovery net.

    A DB blip in either used to strand the row as `pending` until a restart,
    and the up-front busy check reads any active run as a held pipeline, so an
    unfinishable row would refuse every other player's clicks too.
    """
    finished: list[dict[str, object]] = []

    async def load_boom(sync_id: int) -> None:
        raise RuntimeError("database unavailable")

    async def record_finish(sync_id: int, **kwargs: object) -> None:
        finished.append({"sync_id": sync_id, **kwargs})

    monkeypatch.setattr(player_sync_module, "_load_player_sync", load_boom)
    monkeypatch.setattr(player_sync_module, "_finish_sync", record_finish)

    await player_sync_module.run_player_sync(9)

    assert finished
    assert finished[0]["sync_id"] == 9
    assert finished[0]["status"] == "failed"
