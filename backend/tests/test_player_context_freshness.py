"""Per-user player context and persisted sync-lifecycle regressions."""

from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock, Mock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.jobs.base import BaseJob
from app.features.jobs.models import JobStatus
from app.features.jobs.player_sync import (
    _failure_from_job,
    create_or_get_player_sync,
)
from app.features.players.service import PlayerService


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
