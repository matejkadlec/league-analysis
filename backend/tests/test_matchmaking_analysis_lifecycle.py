"""Matchmaking-analysis lifecycle regressions."""

import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import ClauseElement
from starlette.requests import Request

from app.core.riot_api.client import RiotAPIClient
from app.core.riot_api.errors import AuthenticationError, ForbiddenError
from app.features.matchmaking_analysis import router as analysis_router
from app.features.matchmaking_analysis import service as analysis_service_module
from app.features.matchmaking_analysis.models import MatchmakingAnalysis
from app.features.matchmaking_analysis.schemas import MatchmakingAnalysisRequest
from app.features.matchmaking_analysis.service import MatchmakingAnalysisService

_PUUID = "test-puuid"


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


def _analysis(status: str = "pending") -> MatchmakingAnalysis:
    """A persisted run stub carrying every attribute the code under test reads."""
    return cast(
        MatchmakingAnalysis,
        SimpleNamespace(
            puuid=_PUUID,
            created_at=datetime.now(UTC),
            status=status,
            results=None,
            started_at=None,
            completed_at=None,
            error_code=None,
            error_message=None,
            puuid_progress={},
            requests_saved=0,
            rate_limit_reset_at=None,
        ),
    )


def _compiled_values(statement: ClauseElement) -> list[object]:
    params = statement.compile().params
    assert params is not None, "a compiled DML statement always carries bind params"
    return list(params.values())


async def test_start_route_returns_without_riot_preflight() -> None:
    """The start request never owns any long Riot work; it only enqueues."""
    expected = _analysis()
    service = MagicMock(spec=MatchmakingAnalysisService)
    service.start_analysis.return_value = expected

    result = await analysis_router.start_analysis(
        request=_request(),
        payload=MatchmakingAnalysisRequest(puuid=_PUUID),
        service=cast(MatchmakingAnalysisService, service),
    )

    assert result is expected
    service.start_analysis.assert_awaited_once_with(_PUUID)


async def test_repeated_start_attaches_to_the_existing_active_run(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A retry returns the same persisted run instead of creating another."""
    guard = AsyncMock()
    monkeypatch.setattr(
        analysis_service_module,
        "_ensure_riot_writer_maintenance_is_inactive",
        guard,
    )
    existing = _analysis("in_progress")
    database = SimpleNamespace(add=MagicMock())
    service = MatchmakingAnalysisService(
        cast(AsyncSession, database), cast(RiotAPIClient, object())
    )
    service._get_active_analysis = AsyncMock(return_value=existing)
    service._ensure_background_task = MagicMock()

    response = await service.start_analysis(existing.puuid)

    assert response.created_at == existing.created_at
    assert response.status == "in_progress"
    database.add.assert_not_called()
    service._ensure_background_task.assert_called_once_with(
        existing.puuid, existing.created_at
    )


async def test_new_run_replaces_a_finishing_previous_task_handle() -> None:
    """A completed worker's brief cleanup window cannot strand the next run."""
    old_created_at = datetime.now(UTC) - timedelta(minutes=1)
    new_created_at = datetime.now(UTC)
    old_task = asyncio.create_task(asyncio.sleep(60))
    new_started = asyncio.Event()
    database = SimpleNamespace()
    service = MatchmakingAnalysisService(
        cast(AsyncSession, database), cast(RiotAPIClient, object())
    )

    async def run_new_analysis(puuid: str, created_at: datetime) -> None:
        assert puuid == _PUUID
        assert created_at == new_created_at
        new_started.set()

    service._run_analysis_background = run_new_analysis
    analysis_service_module._running_analyses[_PUUID] = (
        analysis_service_module.RunningAnalysis(
            created_at=old_created_at,
            task=old_task,
        )
    )

    try:
        service._ensure_background_task(_PUUID, new_created_at)
        await asyncio.wait_for(new_started.wait(), timeout=1)
        replacement = analysis_service_module._running_analyses[_PUUID]
        assert replacement.created_at == new_created_at
        assert replacement.task is not old_task
        await replacement.task
    finally:
        old_task.cancel()
        await asyncio.gather(old_task, return_exceptions=True)
        analysis_service_module._running_analyses.pop(_PUUID, None)


async def test_cancel_targets_and_retains_the_exact_active_run() -> None:
    """Cancellation records a terminal state instead of deleting progress."""
    active = _analysis("in_progress")
    scalar_result = SimpleNamespace(scalar_one_or_none=lambda: active)
    database = SimpleNamespace(
        execute=AsyncMock(side_effect=[scalar_result, SimpleNamespace()]),
        commit=AsyncMock(),
        delete=AsyncMock(),
    )
    service = MatchmakingAnalysisService(
        cast(AsyncSession, database), cast(RiotAPIClient, object())
    )

    cancelled = await service.cancel_analysis(active.puuid, active.created_at)

    assert cancelled is True
    assert database.execute.await_count == 2
    update_statement = database.execute.await_args_list[1].args[0]
    values = _compiled_values(update_statement)
    assert "cancelled" in values
    assert active.created_at in values
    database.delete.assert_not_awaited()
    database.commit.assert_awaited_once()


async def test_rate_limit_wait_is_persisted_as_an_active_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A bounded Riot wait remains attachable and visible rather than failing."""
    guard = AsyncMock()
    monkeypatch.setattr(
        analysis_service_module,
        "_ensure_riot_writer_maintenance_is_inactive",
        guard,
    )
    reset_result = SimpleNamespace(scalar_one_or_none=lambda: None)
    database = SimpleNamespace(
        execute=AsyncMock(side_effect=[reset_result, SimpleNamespace()]),
        commit=AsyncMock(),
        rollback=AsyncMock(),
    )
    service = MatchmakingAnalysisService(
        cast(AsyncSession, database), cast(RiotAPIClient, object())
    )
    service._current_analysis_puuid = _PUUID
    service._current_analysis_created_at = datetime.now(UTC)
    reset_at = datetime.now(UTC) + timedelta(seconds=90)

    await service._set_rate_limit_reset(reset_at)

    update_statement = database.execute.await_args_list[1].args[0]
    values = _compiled_values(update_statement)
    assert "waiting_rate_limit" in values
    assert reset_at in values
    database.commit.assert_awaited_once()


async def test_analysis_failure_keeps_a_safe_terminal_diagnostic(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Expected failures remain retryable without exposing raw provider text."""
    guard = AsyncMock()
    monkeypatch.setattr(
        analysis_service_module,
        "_ensure_riot_writer_maintenance_is_inactive",
        guard,
    )
    database = SimpleNamespace(execute=AsyncMock(), commit=AsyncMock())
    service = MatchmakingAnalysisService(
        cast(AsyncSession, database), cast(RiotAPIClient, object())
    )
    created_at = datetime.now(UTC)

    await service._complete_with_error(
        _PUUID,
        created_at,
        "Player doesn't have enough ranked matches for this analysis.",
        error_code="not_enough_matches",
    )

    statement = database.execute.await_args.args[0]
    values = _compiled_values(statement)
    assert "failed" in values
    assert "not_enough_matches" in values
    assert "Player doesn't have enough ranked matches for this analysis." in values
    database.commit.assert_awaited_once()


@pytest.mark.parametrize(
    "error",
    [
        AuthenticationError("provider detail", status_code=401),
        ForbiddenError("provider detail", status_code=403),
    ],
)
def test_invalid_key_failure_keeps_the_shared_banner_signal(error: Exception) -> None:
    """Background credentials failures remain detectable through a 200 poll."""
    code, message = MatchmakingAnalysisService._safe_failure_details(error)

    assert code == "RIOT_API_KEY_INVALID"
    assert message == (
        "The Riot API key is invalid or expired. Please update it and try again."
    )
    assert "provider detail" not in message


async def test_optional_fetch_does_not_swallow_invalid_key_failure() -> None:
    """Any rejected Riot call terminates the run even outside the required spine."""
    riot_client = SimpleNamespace(
        get_match_list_by_puuid=AsyncMock(
            side_effect=ForbiddenError("provider detail", status_code=403)
        )
    )
    service = MatchmakingAnalysisService(
        cast(AsyncSession, SimpleNamespace()),
        cast(RiotAPIClient, riot_client),
    )

    with pytest.raises(ForbiddenError):
        await service._api_fetch_match_ids(_PUUID)
