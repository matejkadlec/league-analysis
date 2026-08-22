"""Matchmaking-analysis maintenance interlock regressions."""

from datetime import UTC, datetime
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from app.core.riot_api.client import RiotAPIClient
from app.core.riot_api.models import MatchDTO
from app.features.jobs.maintenance import RiotWriterMaintenanceActiveError
from app.features.matchmaking_analysis import router as analysis_router
from app.features.matchmaking_analysis import service as analysis_service_module
from app.features.matchmaking_analysis.schemas import MatchmakingAnalysisRequest
from app.features.matchmaking_analysis.service import MatchmakingAnalysisService

# The account these tests act as. Every stored run belongs to one, so a service
# cannot be built without saying which.
_USER_ID = 7


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


async def test_new_matchmaking_analysis_refuses_active_maintenance(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An active cleanup cannot create a background analysis record."""
    guard = AsyncMock(side_effect=RiotWriterMaintenanceActiveError())
    monkeypatch.setattr(
        analysis_service_module,
        "ensure_riot_writer_maintenance_is_inactive",
        guard,
    )
    service = MatchmakingAnalysisService(
        cast(AsyncSession, object()), cast(RiotAPIClient, object()), _USER_ID
    )

    with pytest.raises(RiotWriterMaintenanceActiveError):
        await service.start_analysis("test-puuid")

    guard.assert_awaited_once_with(service.db)


async def test_matchmaking_start_returns_maintenance_status() -> None:
    """The start endpoint reports an active cleanup instead of an internal error."""
    service = MagicMock(spec=MatchmakingAnalysisService)
    service.start_analysis.side_effect = RiotWriterMaintenanceActiveError()

    with pytest.raises(HTTPException) as error:
        await analysis_router.start_analysis(
            request=_request(),
            payload=MatchmakingAnalysisRequest(puuid="test-puuid"),
            service=cast(MatchmakingAnalysisService, service),
        )

    assert error.value.status_code == 503
    service.start_analysis.assert_awaited_once_with("test-puuid")


async def test_matchmaking_fetched_match_honors_the_maintenance_interlock(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A pre-existing analysis cannot upsert a fetched match after cleanup."""
    guard = AsyncMock(side_effect=RiotWriterMaintenanceActiveError())
    upsert = AsyncMock()
    monkeypatch.setattr(
        analysis_service_module,
        "ensure_riot_writer_maintenance_is_inactive",
        guard,
    )
    from app.features.matches import match_persistence

    monkeypatch.setattr(match_persistence, "upsert_match", upsert)
    database = object()
    service = MatchmakingAnalysisService(
        cast(AsyncSession, database), cast(RiotAPIClient, object()), _USER_ID
    )

    with pytest.raises(RiotWriterMaintenanceActiveError):
        await service._store_fetched_match(cast(MatchDTO, SimpleNamespace()))

    guard.assert_awaited_once_with(database)
    upsert.assert_not_awaited()


async def test_matchmaking_progress_writes_when_maintenance_is_inactive(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Normal analysis progress remains writable after the guard passes."""
    guard = AsyncMock()
    database = SimpleNamespace(execute=AsyncMock(), commit=AsyncMock())
    monkeypatch.setattr(
        analysis_service_module,
        "ensure_riot_writer_maintenance_is_inactive",
        guard,
    )
    service = MatchmakingAnalysisService(
        cast(AsyncSession, database), cast(RiotAPIClient, object()), _USER_ID
    )
    created_at = datetime.now(UTC)

    await service._update_progress("test-puuid", created_at, {"key": True})

    guard.assert_awaited_once_with(database)
    database.execute.assert_awaited_once()
    database.commit.assert_awaited_once()
