"""Per-user player context and persisted sync-lifecycle regressions."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from app.features.jobs.models import JobStatus
from app.features.jobs.player_sync import (
    _failure_from_job,
    create_or_get_player_sync,
)
from app.features.players.service import PlayerService


@pytest.mark.asyncio
async def test_current_player_update_is_scoped_to_one_application_user() -> None:
    settings = SimpleNamespace(current_player_puuid=None)
    db = SimpleNamespace(
        scalar=AsyncMock(return_value=settings),
        get=AsyncMock(return_value=SimpleNamespace(puuid="player-puuid")),
        execute=AsyncMock(),
        add=Mock(),
        flush=AsyncMock(),
        commit=AsyncMock(),
    )
    service = PlayerService(db)
    service.get_player_context = AsyncMock(return_value="context")  # type: ignore[method-assign]

    result = await service.set_current_player(7, "player-puuid")

    assert result == "context"
    assert settings.current_player_puuid == "player-puuid"
    recency_statement = db.execute.await_args.args[0]
    sql = str(recency_statement)
    assert "auth.user_tracked_players.user_id" in sql
    assert "auth.user_tracked_players.puuid" in sql
    assert 7 in recency_statement.compile().params.values()
    assert "player-puuid" in recency_statement.compile().params.values()
    service.get_player_context.assert_awaited_once_with(7)


def test_all_platform_search_omits_platform_filter() -> None:
    all_platforms = PlayerService._build_player_search_query(
        None,
        "name",
        "current",
        "current",
        None,
    )
    one_platform = PlayerService._build_player_search_query(
        "eun1",
        "name",
        "current",
        "current",
        None,
    )

    assert "lower(core.players.platform)" not in str(all_platforms.whereclause)
    assert "lower(core.players.platform)" in str(one_platform.whereclause)


@pytest.mark.asyncio
async def test_concurrent_explicit_updates_attach_to_the_active_puuid_run() -> None:
    active = SimpleNamespace(id=11, puuid="player-puuid", status="running")
    db = SimpleNamespace(
        get=AsyncMock(return_value=SimpleNamespace(puuid="player-puuid")),
        scalar=AsyncMock(return_value=active),
        add=Mock(),
    )

    sync_run, created = await create_or_get_player_sync(
        db, user_id=7, puuid="player-puuid"
    )

    assert sync_run is active
    assert not created
    db.add.assert_not_called()


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
    job = SimpleNamespace(
        job_execution_id=5,
        job_execution_status=status,
        skipped_as_already_running=False,
        has_api_key_error=lambda: False,
        has_puuid_binding_error=lambda: False,
    )

    mapped_status, code, message = _failure_from_job(job)

    assert (mapped_status, code) == (expected_status, expected_code)
    assert "secret" not in message.lower()
