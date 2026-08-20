"""Matchmaking-analysis logging regressions for previously silent failures."""

import asyncio
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from structlog.testing import capture_logs
from structlog.typing import EventDict

from app.core.riot_api.client import RiotAPIClient
from app.features.matchmaking_analysis import service as analysis_service_module
from app.features.matchmaking_analysis.service import (
    RunningAnalysis,
)

_PUUID = "p" * 78


def _events(logs: list[EventDict], event_name: str) -> list[EventDict]:
    return [entry for entry in logs if entry.get("event") == event_name]


class _SessionStub:
    """Minimal async session double for the background worker."""

    def __init__(self, *, fail_execute: bool = False) -> None:
        self.fail_execute = fail_execute

    async def __aenter__(self) -> _SessionStub:
        return self

    async def __aexit__(self, *_exc: object) -> None:
        return None

    async def execute(self, *_args: object, **_kwargs: object) -> object:
        if self.fail_execute:
            raise RuntimeError("session boom")
        return SimpleNamespace()

    async def commit(self) -> None:
        return None


class _FakeClient:
    """Async-context stand-in for the tracked Riot client."""

    async def __aenter__(self) -> _FakeClient:
        return self

    async def __aexit__(self, *_exc: object) -> None:
        return None


def _unused_database() -> object:
    """A placeholder session; these paths open their own sessions."""
    return object()


@pytest.mark.asyncio
async def test_failure_state_persist_failure_is_logged(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An analysis failure whose failure-recording also fails is visible."""
    monkeypatch.setattr(
        analysis_service_module.db_manager,
        "get_session",
        lambda: _SessionStub(fail_execute=True),
    )

    async def _no_key(_db: object) -> None:
        raise ValueError("no active Riot API key")

    monkeypatch.setattr(
        analysis_service_module, "create_tracked_riot_api_client", _no_key
    )

    service = analysis_service_module.MatchmakingAnalysisService(
        cast(AsyncSession, _unused_database()), cast(RiotAPIClient, SimpleNamespace())
    )

    with capture_logs() as logs:
        await service._run_analysis_background(_PUUID, datetime.now(UTC))

    entries = _events(logs, "matchmaking_failure_state_persist_failed")
    assert len(entries) == 1
    assert entries[0]["error_type"] == "RuntimeError"
    assert entries[0]["error_code"] == "RIOT_API_KEY_INVALID"
    assert entries[0]["puuid"] == _PUUID


async def _dying_worker() -> None:
    try:
        await asyncio.sleep(30)
    except asyncio.CancelledError:
        raise ValueError("worker broke during cancel") from None


@pytest.mark.asyncio
async def test_cancel_await_failure_is_logged() -> None:
    """A worker that dies while being cancelled stays suppressed but visible."""
    created_at = datetime.now(UTC)
    worker = asyncio.create_task(_dying_worker())
    analysis_service_module._running_analyses[_PUUID] = RunningAnalysis(
        created_at=created_at,
        task=worker,
    )
    # Let the worker reach its suspension point before cancellation.
    await asyncio.sleep(0)
    await asyncio.sleep(0)

    try:
        scalar_result = SimpleNamespace(
            scalar_one_or_none=lambda: SimpleNamespace(puuid=_PUUID)
        )
        database = SimpleNamespace(
            execute=AsyncMock(side_effect=[scalar_result, SimpleNamespace()]),
            commit=AsyncMock(),
        )
        service = analysis_service_module.MatchmakingAnalysisService(
            cast(AsyncSession, database), cast(RiotAPIClient, object())
        )

        with capture_logs() as logs:
            assert await service.cancel_analysis(_PUUID, created_at) is True

        entries = _events(logs, "matchmaking_analysis_cancel_await_failed")
        assert len(entries) == 1
        assert entries[0]["error_type"] == "ValueError"
        assert entries[0]["puuid"] == _PUUID
    finally:
        analysis_service_module._running_analyses.pop(_PUUID, None)
        await asyncio.gather(worker, return_exceptions=True)


@pytest.mark.asyncio
async def test_normal_cancel_await_stays_silent() -> None:
    """Awaiting a cleanly cancelled worker must not log a warning."""
    created_at = datetime.now(UTC)
    worker = asyncio.create_task(asyncio.sleep(30))
    analysis_service_module._running_analyses[_PUUID] = RunningAnalysis(
        created_at=created_at,
        task=worker,
    )
    await asyncio.sleep(0)

    try:
        scalar_result = SimpleNamespace(
            scalar_one_or_none=lambda: SimpleNamespace(puuid=_PUUID)
        )
        database = SimpleNamespace(
            execute=AsyncMock(side_effect=[scalar_result, SimpleNamespace()]),
            commit=AsyncMock(),
        )
        service = analysis_service_module.MatchmakingAnalysisService(
            cast(AsyncSession, database), cast(RiotAPIClient, object())
        )

        with capture_logs() as logs:
            assert await service.cancel_analysis(_PUUID, created_at) is True

        assert _events(logs, "matchmaking_analysis_cancel_await_failed") == []
    finally:
        analysis_service_module._running_analyses.pop(_PUUID, None)
        await asyncio.gather(worker, return_exceptions=True)
