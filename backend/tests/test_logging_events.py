"""Static-event and previously-silent-path logging regressions."""

from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any, cast, override
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from structlog.testing import capture_logs
from structlog.typing import EventDict

from app.core.database import DatabaseManager
from app.core.riot_api.errors import AuthenticationError, RateLimitError
from app.features.jobs.base import BaseJob, _validation_field_locations
from app.features.jobs.error_handling import RateLimitSignal, _handle_error
from app.features.jobs.log_capture import BoundedLogCapture
from app.features.matches import match_persistence
from app.features.matches import service as matches_service_module
from app.features.matches.match_stats import advanced_int
from app.features.matches.timeline import _uses_historical_atakhan_contract
from app.features.playstyle_analysis.service import PlaystyleAnalysisService
from app.features.smurf_boost_detection.config import MODEL_VERSION, PRESETS
from app.features.smurf_boost_detection.models import SmurfBoostAnalysis
from app.features.smurf_boost_detection.service import (
    SmurfBoostDetectionError,
    SmurfBoostDetectionService,
)

CONSERVATIVE = {key: float(value) for key, value in PRESETS["conservative"].items()}


def _events(logs: list[EventDict], event_name: str) -> list[EventDict]:
    return [entry for entry in logs if entry.get("event") == event_name]


def test_job_log_capture_only_captures_job_tagged_entries() -> None:
    """Request-scoped traffic must not evict job entries from the deque."""
    capture = BoundedLogCapture(maxlen=3)

    def _run(event_dict: dict[str, Any]) -> None:
        returned = capture(None, "info", event_dict)
        assert returned is event_dict

    _run({"event": "http_request_completed", "path": "/api/v1/players"})
    _run({"event": "job_started", "job_execution_id": 42})
    _run({"event": "login_failed", "reason": "unknown_email"})
    _run({"event": "job_progress", "job_execution_id": 42})

    assert [entry["event"] for entry in capture.entries] == [
        "job_started",
        "job_progress",
    ]


class _FakeSession:
    """Async session stand-in recording rollbacks."""

    def __init__(self) -> None:
        self.rollbacks = 0

    async def __aenter__(self) -> _FakeSession:
        return self

    async def __aexit__(self, *_args: object) -> None:
        return None

    async def rollback(self) -> None:
        self.rollbacks += 1

    async def close(self) -> None:
        return None


def _session_with_fake_factory() -> tuple[DatabaseManager, _FakeSession]:
    manager = DatabaseManager.__new__(DatabaseManager)
    session = _FakeSession()
    # __new__ skips engine construction; the session factory is swapped for
    # the recording stand-in get_session actually exercises.
    cast("Any", manager).async_session_factory = lambda: session
    return manager, session


@pytest.mark.asyncio
async def test_http_exception_rollback_logs_debug_not_warning() -> None:
    """Route HTTPExceptions unwind through get_session; they are ordinary
    4xx traffic already recorded by the completion event, not DB failures."""
    manager, session = _session_with_fake_factory()

    with capture_logs() as logs, pytest.raises(HTTPException):
        async with manager.get_session():
            raise HTTPException(status_code=404, detail="missing")

    assert session.rollbacks == 1
    entries = _events(logs, "database_session_rollback")
    assert len(entries) == 1
    assert entries[0]["log_level"] == "debug"
    assert entries[0]["error_type"] == "HTTPException"


@pytest.mark.asyncio
async def test_unexpected_rollback_still_logs_warning() -> None:
    manager, _session = _session_with_fake_factory()

    with capture_logs() as logs, pytest.raises(ValueError):
        async with manager.get_session():
            raise ValueError("connection gone")

    entries = _events(logs, "database_session_rollback")
    assert len(entries) == 1
    assert entries[0]["log_level"] == "warning"
    assert entries[0]["error_type"] == "ValueError"


def _raise_through(error: Exception, operation: str, *, critical: bool = True) -> None:
    """Call `_handle_error` from a real except block, as the decorators do."""
    try:
        raise error
    except Exception:
        _handle_error(error, operation, critical, {})


def test_job_error_handler_logs_static_events_with_operation_field() -> None:
    """Each error class keeps the operation as a field on a static event."""
    with capture_logs() as logs:
        with pytest.raises(RateLimitSignal):
            _raise_through(
                RateLimitError("limited", status_code=429, retry_after=45),
                "fetch matches",
            )
        with pytest.raises(AuthenticationError):
            _raise_through(
                AuthenticationError("bad key", status_code=401),
                "update player",
            )
        with pytest.raises(RuntimeError):
            _raise_through(RuntimeError("boom"), "sync history")

    rate_limit = _events(logs, "job_rate_limit_hit")
    assert rate_limit[0]["operation"] == "fetch matches"
    assert rate_limit[0]["retry_after"] == 45

    auth = _events(logs, "job_authentication_failed")
    assert auth[0]["operation"] == "update player"

    operation = _events(logs, "job_operation_failed")
    assert operation[0]["operation"] == "sync history"
    assert operation[0]["error_type"] == "RuntimeError"


class _ProbeJob(BaseJob):
    """Minimal concrete job driving one helper directly."""

    @override
    async def execute(self, db: AsyncSession) -> None:
        return None


@pytest.mark.asyncio
async def test_safe_commit_failure_logs_operation_field() -> None:
    """A failed commit names the operation instead of baking it into the event."""
    job = _ProbeJob(job_config_id=7)
    database = SimpleNamespace(
        commit=AsyncMock(side_effect=RuntimeError("commit boom")),
        rollback=AsyncMock(),
    )

    with capture_logs() as logs:
        assert await job.safe_commit(cast(AsyncSession, database), "job start") is False

    entries = _events(logs, "job_commit_failed")
    assert len(entries) == 1
    assert entries[0]["operation"] == "job start"
    assert entries[0]["error_type"] == "RuntimeError"
    database.rollback.assert_awaited_once()


def test_validation_field_locations_failure_logs_debug() -> None:
    """A raising `errors()` diagnostic degrades to no locations, visibly."""

    class _BrokenPydanticError(Exception):
        def errors(self) -> list[dict[str, Any]]:
            raise RuntimeError("broken errors()")

    with capture_logs() as logs:
        assert _validation_field_locations(_BrokenPydanticError()) == []

    entries = _events(logs, "job_validation_field_locations_failed")
    assert len(entries) == 1
    assert entries[0]["error_type"] == "RuntimeError"
    assert entries[0]["log_level"] == "debug"


def test_stat_coercion_failure_names_the_stat_key() -> None:
    """A non-numeric advanced stat falls back to zero with a debug breadcrumb."""
    with capture_logs() as logs:
        assert advanced_int({"dragonTakedowns": "many"}, "dragonTakedowns") == 0

    entries = _events(logs, "match_stat_coercion_failed")
    assert len(entries) == 1
    assert entries[0]["key"] == "dragonTakedowns"
    assert entries[0]["got_type"] == "str"


def test_timeline_version_parse_failure_logs_debug() -> None:
    """An unparsable game version reads as current, with a debug trace."""
    with capture_logs() as logs:
        assert _uses_historical_atakhan_contract("unknown-version") is False

    entries = _events(logs, "timeline_version_parse_failed")
    assert len(entries) == 1
    assert entries[0]["game_version"] == "unknown-version"


def test_invalid_sync_queue_ids_are_reported() -> None:
    """Queue IDs that cannot coerce are skipped with the values attached."""
    service = matches_service_module.MatchService(cast(AsyncSession, object()))

    with capture_logs() as logs:
        assert service._normalize_sync_queue_ids(cast("list[int]", ["abc", 420])) == [
            420
        ]

    entries = _events(logs, "invalid_queue_ids_skipped")
    assert len(entries) == 1
    assert entries[0]["invalid_queue_ids"] == ["abc"]
    assert entries[0]["count"] == 1


def _fake_record(*_args: object, **_kwargs: object) -> object:
    return object()


@pytest.mark.asyncio
async def test_upsert_match_failure_logs_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A failed match persist logs the identifier before the quiet rollback."""
    monkeypatch.setattr(match_persistence, "build_match_record", _fake_record)
    monkeypatch.setattr(match_persistence, "merge_reprocess_participants", AsyncMock())
    monkeypatch.setattr(
        match_persistence, "replace_match_timeline_rows", AsyncMock(return_value=1)
    )

    database = SimpleNamespace(
        merge=AsyncMock(),
        commit=AsyncMock(side_effect=RuntimeError("persist boom")),
        rollback=AsyncMock(),
    )
    match_dto = cast(
        Any,
        SimpleNamespace(
            metadata=SimpleNamespace(match_id="EUN1_1"),
            info=SimpleNamespace(platform="EUN1", participants=[]),
        ),
    )

    with capture_logs() as logs, pytest.raises(RuntimeError, match="persist boom"):
        await match_persistence.upsert_match(cast(AsyncSession, database), match_dto)

    entries = _events(logs, "Failed to upsert match")
    assert len(entries) == 1
    assert entries[0]["match_id"] == "EUN1_1"
    database.rollback.assert_awaited_once()


@pytest.mark.asyncio
async def test_smurf_conflict_without_concurrent_run_is_logged() -> None:
    """An IntegrityError with nothing to attach to is re-raised visibly."""
    database = MagicMock(
        commit=AsyncMock(side_effect=IntegrityError("stmt", {}, ValueError("race"))),
        rollback=AsyncMock(),
    )
    service = SmurfBoostDetectionService(cast(AsyncSession, database))
    service._expire_abandoned = AsyncMock()
    service._active_run = AsyncMock(return_value=None)
    service._newest_run = AsyncMock(return_value=None)

    with capture_logs() as logs, pytest.raises(IntegrityError):
        await service._claim_run("p", dict(CONSERVATIVE))

    entries = _events(logs, "smurf_boost_detection_integrity_conflict")
    assert len(entries) == 1
    assert entries[0]["error_type"] == "IntegrityError"
    assert entries[0]["puuid"] == "p"


@pytest.mark.asyncio
async def test_smurf_detection_error_branch_logs_warning() -> None:
    """A reviewed detection failure persists `_fail` and now also logs."""
    service = SmurfBoostDetectionService(
        cast(AsyncSession, MagicMock(rollback=AsyncMock()))
    )
    created_at = datetime.now(UTC)
    service._claim_run = AsyncMock(return_value=(created_at, None))
    service._build_request = AsyncMock(
        side_effect=SmurfBoostDetectionError("rate_limit_unavailable", "busy")
    )
    service._fail = AsyncMock()
    service._reload = AsyncMock(
        return_value=SmurfBoostAnalysis(
            puuid="p",
            created_at=created_at,
            status="failed",
            model_version=MODEL_VERSION,
            thresholds=dict(CONSERVATIVE),
            eligible_games=0,
        )
    )

    with capture_logs() as logs:
        await service.run_analysis("p", dict(CONSERVATIVE))

    entries = _events(logs, "smurf_boost_detection_failed")
    assert len(entries) == 1
    assert entries[0]["error_code"] == "rate_limit_unavailable"
    assert entries[0]["puuid"] == "p"
    service._fail.assert_awaited_once_with(
        "p", created_at, "rate_limit_unavailable", "busy"
    )


class _ScalarsStub:
    """Typed stand-in for a scalars() result."""

    def __init__(self, items: list[object]) -> None:
        self._items = items

    def all(self) -> list[object]:
        return self._items


class _ExecuteResult:
    """Typed stand-in for an execute() result in either shape used."""

    def __init__(self, *, items: list[object] | None = None, scalar: object = None):
        self._items = items
        self._scalar = scalar

    def scalars(self) -> _ScalarsStub:
        assert self._items is not None, "this result answers scalars()"
        return _ScalarsStub(self._items)

    def scalar_one(self) -> object:
        return self._scalar

    def scalar_one_or_none(self) -> object:
        return self._scalar


@pytest.mark.asyncio
async def test_playstyle_degradations_are_visible() -> None:
    """No-match-data fallbacks and a missing player row both leave a trace."""
    empty_participants = _ExecuteResult(items=[])
    no_player = _ExecuteResult(scalar=None)
    database = SimpleNamespace(
        execute=AsyncMock(
            side_effect=[empty_participants, no_player, _ExecuteResult(), no_player]
        ),
        add=MagicMock(),
        commit=AsyncMock(),
        refresh=AsyncMock(),
    )
    service = PlaystyleAnalysisService(cast(AsyncSession, database))

    with capture_logs() as logs:
        await service.analyze_playstyle("p" * 78)

    empty = _events(logs, "playstyle_analysis_no_match_data")
    assert len(empty) == 1
    assert empty[0]["puuid"] == "p" * 78

    missing = _events(logs, "playstyle_analysis_player_row_missing")
    assert len(missing) == 1
    assert missing[0]["puuid"] == "p" * 78


@pytest.mark.asyncio
async def test_close_disposes_the_engine_the_scripts_shut_down() -> None:
    # `validate_migrations.py` and `reconcile_admin_account.py` both end with
    # `await db_manager.close()`; if it stops delegating to dispose, their
    # connections leak past process intent silently.
    manager = DatabaseManager.__new__(DatabaseManager)
    disposed: list[bool] = []

    class Engine:
        async def dispose(self) -> None:
            disposed.append(True)

    cast("Any", manager).engine = Engine()

    await manager.close()

    assert disposed == [True]
