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
from app.features.matchmaking_analysis.ranks import summarize_ranks
from app.features.matchmaking_analysis.schemas import (
    MatchmakingAnalysisParams,
    MatchmakingAnalysisRequest,
)
from app.features.matchmaking_analysis.service import MatchmakingAnalysisService

# The account these tests act as. Every stored run belongs to one, so a service
# cannot be built without saying which.
_USER_ID = 7

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
            params=None,
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
    service.start_analysis.assert_awaited_once_with(_PUUID, MatchmakingAnalysisParams())


async def test_repeated_start_attaches_to_the_existing_active_run(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A retry returns the same persisted run instead of creating another."""
    guard = AsyncMock()
    monkeypatch.setattr(
        analysis_service_module,
        "ensure_riot_writer_maintenance_is_inactive",
        guard,
    )
    existing = _analysis("in_progress")
    database = SimpleNamespace(add=MagicMock())
    service = MatchmakingAnalysisService(
        cast(AsyncSession, database), cast(RiotAPIClient, object()), _USER_ID
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
        cast(AsyncSession, database), cast(RiotAPIClient, object()), _USER_ID
    )

    async def run_new_analysis(puuid: str, created_at: datetime) -> None:
        assert puuid == _PUUID
        assert created_at == new_created_at
        new_started.set()

    service._run_analysis_background = run_new_analysis
    analysis_service_module._running_analyses[(_USER_ID, _PUUID)] = (
        analysis_service_module.RunningAnalysis(
            created_at=old_created_at,
            task=old_task,
        )
    )

    try:
        service._ensure_background_task(_PUUID, new_created_at)
        await asyncio.wait_for(new_started.wait(), timeout=1)
        replacement = analysis_service_module._running_analyses[(_USER_ID, _PUUID)]
        assert replacement.created_at == new_created_at
        assert replacement.task is not old_task
        await replacement.task
    finally:
        old_task.cancel()
        await asyncio.gather(old_task, return_exceptions=True)
        analysis_service_module._running_analyses.pop((_USER_ID, _PUUID), None)


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
        cast(AsyncSession, database), cast(RiotAPIClient, object()), _USER_ID
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
        "ensure_riot_writer_maintenance_is_inactive",
        guard,
    )
    reset_result = SimpleNamespace(scalar_one_or_none=lambda: None)
    database = SimpleNamespace(
        execute=AsyncMock(side_effect=[reset_result, SimpleNamespace()]),
        commit=AsyncMock(),
        rollback=AsyncMock(),
    )
    service = MatchmakingAnalysisService(
        cast(AsyncSession, database), cast(RiotAPIClient, object()), _USER_ID
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
        "ensure_riot_writer_maintenance_is_inactive",
        guard,
    )
    database = SimpleNamespace(execute=AsyncMock(), commit=AsyncMock())
    service = MatchmakingAnalysisService(
        cast(AsyncSession, database), cast(RiotAPIClient, object()), _USER_ID
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
        _USER_ID,
    )

    with pytest.raises(ForbiddenError):
        await service._api_fetch_match_ids(_PUUID)


def _spine_stat(
    match_id: str = "EUN1_1",
    team_avg: float | None = 0.5,
    enemy_avg: float | None = 0.6,
    ally_puuids: list[str] | None = None,
) -> analysis_service_module.SpineMatchStats:
    return analysis_service_module.SpineMatchStats(
        match_id=match_id,
        team_avg=team_avg,
        enemy_avg=enemy_avg,
        ally_puuids=ally_puuids or [],
    )


def _completion_results(
    spine_stats: list[analysis_service_module.SpineMatchStats],
    matches_analyzed: int = 0,
) -> analysis_service_module.MatchmakingAnalysisResultsJSON:
    return analysis_service_module._build_completion_results(
        spine_stats,
        matches_analyzed=matches_analyzed,
        matches_requested=10,
        rank_summary=summarize_ranks(set(), set(), {}, {}),
        rank_period_accurate=0,
        rank_current_day=0,
    )


@pytest.mark.parametrize(
    "spine_stats",
    [
        [],
        [_spine_stat(enemy_avg=None)],
        [_spine_stat(team_avg=None)],
    ],
    ids=["neither-side", "no-enemies", "no-team"],
)
def test_a_run_that_measured_nothing_is_not_a_completed_run(
    spine_stats: list[analysis_service_module.SpineMatchStats],
) -> None:
    """0.0% vs 0.0% used to be written as a fair-matchmaking verdict.

    Every spine match failing to load returns None from the optional fetch, so
    both averages fell back to 0.0 and the run was still stamped `completed`.
    The failure path already persists a terminal diagnostic.
    """
    with pytest.raises(analysis_service_module.MatchmakingAnalysisRuntimeError):
        _completion_results(spine_stats)


def test_the_basis_reported_to_the_viewer_is_the_one_that_was_read() -> None:
    """ "Based on N ranked matches" was the constant 910, whatever was read.

    Nearly every player in this database has fewer than ten ranked games, so
    the number under the verdict was never the number of matches behind it.
    """
    results = _completion_results([_spine_stat()], matches_analyzed=37)

    assert results["matches_analyzed"] == 37


def test_one_sided_spine_matches_feed_the_headline_but_not_per_match() -> None:
    """`per_match` exists for scope splits, which need comparable pairs."""
    results = _completion_results(
        [
            _spine_stat("EUN1_1", team_avg=0.4, enemy_avg=0.6),
            _spine_stat("EUN1_2", team_avg=0.8, enemy_avg=None),
        ],
        matches_analyzed=5,
    )

    assert results["team_avg_winrate"] == pytest.approx(0.6)
    assert results["enemy_avg_winrate"] == pytest.approx(0.6)
    per_match = results.get("per_match")
    assert per_match is not None
    assert [entry["match_id"] for entry in per_match] == ["EUN1_1"]


def test_recurring_teammates_flag_their_spine_matches_as_duo() -> None:
    """The duo flag rides `per_match`, computed from the recurring-ally rule."""
    results = _completion_results(
        [
            _spine_stat("EUN1_1", ally_puuids=["partner", "a", "b", "c"]),
            _spine_stat("EUN1_2", ally_puuids=["partner", "d", "e", "f"]),
            _spine_stat("EUN1_3", ally_puuids=["g", "h", "i", "j"]),
        ],
        matches_analyzed=30,
    )

    per_match = results.get("per_match")
    assert per_match is not None
    duo_by_match = {e["match_id"]: e["duo"] for e in per_match}
    assert duo_by_match == {"EUN1_1": True, "EUN1_2": True, "EUN1_3": False}


async def test_request_scoped_service_is_built_without_a_riot_client() -> None:
    """A lapsed Riot key must never block the pure DB reads.

    `get_riot_client` refuses the whole request when no key is active, and
    injected into this feature's service it took down `latest-completed`,
    `history` and `status` with it. Only the background instance talks to Riot.
    """
    from app.features.auth.models import User
    from app.features.matchmaking_analysis.dependencies import (
        get_matchmaking_service,
    )

    service = await get_matchmaking_service(
        db=MagicMock(spec=AsyncSession),
        current_user=cast(User, SimpleNamespace(id=_USER_ID)),
    )

    assert service.riot_client is None
    with pytest.raises(AuthenticationError):
        _ = service._riot


def _bare_service() -> MatchmakingAnalysisService:
    return MatchmakingAnalysisService(
        cast(AsyncSession, SimpleNamespace()),
        cast(RiotAPIClient, object()),
        _USER_ID,
    )


async def test_a_resumed_worker_reads_its_params_from_the_run_row() -> None:
    """A restarted process has no request payload; the row is the source."""
    service = _bare_service()
    run = _analysis()
    run.params = {"match_count": 20, "end_date": "2026-07-26"}
    service._get_analysis = AsyncMock(return_value=run)

    await service._load_run_params(_PUUID, run.created_at)

    assert service.match_count == 20
    assert str(service.end_date) == "2026-07-26"
    # Exclusive next-midnight UTC: the whole chosen day is inside the window.
    assert service._spine_end_time_seconds == int(
        datetime(2026, 7, 27, tzinfo=UTC).timestamp()
    )


async def test_a_legacy_row_without_params_resumes_as_a_ten_match_run() -> None:
    service = _bare_service()
    service._get_analysis = AsyncMock(return_value=_analysis())

    await service._load_run_params(_PUUID, datetime.now(UTC))

    assert service.match_count == 10
    assert service.end_date is None
    assert service._spine_end_time_seconds is None


async def test_spine_fetch_uses_the_runs_count_and_end_time() -> None:
    service = _bare_service()
    service.match_count = 20
    service.end_date = datetime(2026, 7, 26, tzinfo=UTC).date()
    service._api_fetch_match_ids = AsyncMock(return_value=[f"m{i}" for i in range(20)])

    result = await service._load_spine_match_ids(_PUUID, datetime.now(UTC))

    assert result is not None and len(result) == 20
    service._api_fetch_match_ids.assert_awaited_once_with(
        _PUUID,
        count=20,
        end_time=int(datetime(2026, 7, 27, tzinfo=UTC).timestamp()),
        required=True,
    )


async def test_a_sparse_window_above_the_floor_still_analyzes() -> None:
    """12 of 30 found a month back is a valid run, not a failure."""
    service = _bare_service()
    service.match_count = 30
    service._api_fetch_match_ids = AsyncMock(return_value=[f"m{i}" for i in range(12)])
    service._complete_with_error = AsyncMock()

    result = await service._load_spine_match_ids(_PUUID, datetime.now(UTC))

    assert result is not None and len(result) == 12
    service._complete_with_error.assert_not_awaited()


async def test_below_the_floor_fails_with_not_enough_matches() -> None:
    service = _bare_service()
    service._api_fetch_match_ids = AsyncMock(return_value=["m0", "m1", "m2", "m3"])
    service._complete_with_error = AsyncMock()

    result = await service._load_spine_match_ids(_PUUID, datetime.now(UTC))

    assert result is None
    await_args = service._complete_with_error.await_args
    assert await_args is not None
    assert await_args.kwargs["error_code"] == "not_enough_matches"
