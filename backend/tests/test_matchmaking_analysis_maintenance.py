"""Matchmaking-analysis maintenance interlock regressions."""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.features.jobs.maintenance import RiotWriterMaintenanceActiveError
from app.features.matchmaking_analysis import router as analysis_router
from app.features.matchmaking_analysis import service as analysis_service_module
from app.features.matchmaking_analysis.service import MatchmakingAnalysisService


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
async def test_new_matchmaking_analysis_refuses_active_maintenance(monkeypatch) -> None:
    """An active cleanup cannot create a background analysis record."""
    guard = AsyncMock(side_effect=RiotWriterMaintenanceActiveError())
    monkeypatch.setattr(
        analysis_service_module,
        "_ensure_riot_writer_maintenance_is_inactive",
        guard,
    )
    service = MatchmakingAnalysisService(object(), object())  # type: ignore[arg-type]

    with pytest.raises(RiotWriterMaintenanceActiveError):
        await service.start_analysis("test-puuid")

    guard.assert_awaited_once_with(service.db)


@pytest.mark.asyncio
async def test_matchmaking_start_returns_maintenance_status(monkeypatch) -> None:
    """The start endpoint reports an active cleanup instead of an internal error."""
    service = SimpleNamespace(
        check_player_has_enough_matches=AsyncMock(
            side_effect=AssertionError("start must not wait for Riot preflight")
        ),
        start_analysis=AsyncMock(side_effect=RiotWriterMaintenanceActiveError()),
    )

    with pytest.raises(HTTPException) as error:
        await analysis_router.start_analysis(
            request=_request(),
            payload=SimpleNamespace(puuid="test-puuid"),
            service=service,
        )

    assert error.value.status_code == 503
    service.check_player_has_enough_matches.assert_not_awaited()
    service.start_analysis.assert_awaited_once_with("test-puuid")


@pytest.mark.asyncio
async def test_matchmaking_fetched_match_honors_the_maintenance_interlock(
    monkeypatch,
) -> None:
    """A pre-existing analysis cannot upsert a fetched match after cleanup."""
    guard = AsyncMock(side_effect=RiotWriterMaintenanceActiveError())
    upsert = AsyncMock()
    monkeypatch.setattr(
        analysis_service_module,
        "_ensure_riot_writer_maintenance_is_inactive",
        guard,
    )
    from app.core import match_utils

    monkeypatch.setattr(match_utils, "_upsert_match", upsert)
    database = object()
    service = MatchmakingAnalysisService(database, object())  # type: ignore[arg-type]

    with pytest.raises(RiotWriterMaintenanceActiveError):
        await service._store_fetched_match(SimpleNamespace())

    guard.assert_awaited_once_with(database)
    upsert.assert_not_awaited()


@pytest.mark.asyncio
async def test_matchmaking_progress_writes_when_maintenance_is_inactive(
    monkeypatch,
) -> None:
    """Normal analysis progress remains writable after the guard passes."""
    guard = AsyncMock()
    database = SimpleNamespace(execute=AsyncMock(), commit=AsyncMock())
    monkeypatch.setattr(
        analysis_service_module,
        "_ensure_riot_writer_maintenance_is_inactive",
        guard,
    )
    service = MatchmakingAnalysisService(database, object())  # type: ignore[arg-type]
    created_at = datetime.now(timezone.utc)

    await service._update_progress("test-puuid", created_at, {"key": True})

    guard.assert_awaited_once_with(database)
    database.execute.assert_awaited_once()
    database.commit.assert_awaited_once()
