"""Matchmaking-analysis lifecycle regressions."""

import asyncio
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import Insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import ClauseElement
from starlette.requests import Request

from app.core.enums import Division, Tier
from app.core.riot_api.client import RiotAPIClient
from app.core.riot_api.errors import AuthenticationError, ForbiddenError
from app.core.riot_api.models import LeagueEntryDTO
from app.features.matchmaking_analysis import router as analysis_router
from app.features.matchmaking_analysis import service as analysis_service_module
from app.features.matchmaking_analysis.models import MatchmakingAnalysis
from app.features.matchmaking_analysis.ranks import rank_value, summarize_ranks
from app.features.matchmaking_analysis.schemas import (
    MatchmakingAnalysisParams,
    MatchmakingAnalysisRequest,
)
from app.features.matchmaking_analysis.service import (
    HISTORICAL_RANK_WINDOW,
    RANK_SNAPSHOT_MAX_AGE,
    MatchmakingAnalysisService,
)

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


async def test_status_poll_resumes_a_run_whose_worker_did_not_survive() -> None:
    """A deploy mid-run cancels the task but keeps the row active; the poll
    is the only caller left that can re-arm it."""
    active = _analysis("in_progress")
    database = SimpleNamespace(
        execute=AsyncMock(
            return_value=SimpleNamespace(scalar_one_or_none=lambda: active)
        )
    )
    service = MatchmakingAnalysisService(
        cast(AsyncSession, database), cast(RiotAPIClient, object()), _USER_ID
    )
    service._ensure_background_task = MagicMock()

    response = await service.get_analysis_status(_PUUID, active.created_at)

    assert response is not None
    assert response.status == "in_progress"
    service._ensure_background_task.assert_called_once_with(_PUUID, active.created_at)


async def test_status_poll_leaves_a_finished_run_alone() -> None:
    """Polling a terminal run must never spawn a worker for it."""
    done = _analysis("completed")
    database = SimpleNamespace(
        execute=AsyncMock(return_value=SimpleNamespace(scalar_one_or_none=lambda: done))
    )
    service = MatchmakingAnalysisService(
        cast(AsyncSession, database), cast(RiotAPIClient, object()), _USER_ID
    )
    service._ensure_background_task = MagicMock()

    await service.get_analysis_status(_PUUID, done.created_at)

    service._ensure_background_task.assert_not_called()


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
    enemy_puuids: list[str] | None = None,
    win: bool | None = None,
    team_kda: float | None = None,
    enemy_kda: float | None = None,
    team_kill_participation: float | None = None,
    enemy_kill_participation: float | None = None,
    team_damage_share: float | None = None,
    enemy_damage_share: float | None = None,
) -> analysis_service_module.SpineMatchStats:
    """One spine match whose per-side aggregates resolve to the given values.

    Samples sit under synthetic per-match puuids, so they never recur across
    matches and the duo-partner exclusion cannot swallow them."""

    def side(
        avg: float | None, kda: float | None, kp: float | None, ds: float | None
    ) -> tuple[dict[str, float], dict[str, analysis_service_module.PlayerPerformance]]:
        winrates = {} if avg is None else {f"wr-{match_id}": avg}
        performances = (
            {}
            if kda is None
            else {
                f"perf-{match_id}": analysis_service_module.PlayerPerformance(
                    kda=kda, kill_participation=kp, damage_share=ds
                )
            }
        )
        return winrates, performances

    ally_winrates, ally_performances = side(
        team_avg, team_kda, team_kill_participation, team_damage_share
    )
    enemy_winrates, enemy_performances = side(
        enemy_avg, enemy_kda, enemy_kill_participation, enemy_damage_share
    )
    return analysis_service_module.SpineMatchStats(
        match_id=match_id,
        ally_puuids=ally_puuids or [],
        enemy_puuids=enemy_puuids or [],
        win=win,
        ally_winrates=ally_winrates,
        enemy_winrates=enemy_winrates,
        ally_performances=ally_performances,
        enemy_performances=enemy_performances,
    )


def _completion_results(
    spine_stats: list[analysis_service_module.SpineMatchStats],
    matches_analyzed: int = 0,
) -> analysis_service_module.MatchmakingAnalysisResultsJSON:
    return analysis_service_module.build_completion_results(
        spine_stats,
        matches_analyzed=matches_analyzed,
        matches_requested=10,
        rank_summary=summarize_ranks(set(), set(), {}, {}),
        player_ranks={},
        rank_period_accurate=0,
        rank_current_day=0,
        analyzed_puuid="analyzed",
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


def _raw_stat(
    match_id: str,
    allies: list[str],
    ally_winrates: dict[str, float],
) -> analysis_service_module.SpineMatchStats:
    return analysis_service_module.SpineMatchStats(
        match_id=match_id,
        ally_puuids=allies,
        enemy_puuids=[f"foe-{match_id}"],
        win=None,
        ally_winrates=ally_winrates,
        enemy_winrates={f"foe-{match_id}": 0.5},
        ally_performances={},
        enemy_performances={},
    )


def test_analyzed_player_and_duo_partner_stay_out_of_ally_averages() -> None:
    """Matchmaking never chose either of them: the analyzed player and the
    inferred duo partners must not tilt the ally winrate averages."""
    results = _completion_results(
        [
            _raw_stat(
                "EUN1_1",
                ["analyzed", "partner", "r1"],
                {"analyzed": 1.0, "partner": 1.0, "r1": 0.4},
            ),
            _raw_stat(
                "EUN1_2",
                ["analyzed", "partner", "r2"],
                {"analyzed": 1.0, "partner": 1.0, "r2": 0.6},
            ),
        ],
        matches_analyzed=2,
    )

    assert results["team_avg_winrate"] == pytest.approx(0.5)
    per_match = results.get("per_match")
    assert per_match is not None
    assert [entry["team_avg"] for entry in per_match] == [0.4, 0.6]
    assert all(entry["duo"] for entry in per_match)


def test_the_analyzed_players_win_flag_rides_per_match() -> None:
    """The scope W-L record is client-side; the flag must survive to JSON."""
    results = _completion_results(
        [
            _spine_stat("EUN1_1", win=True),
            _spine_stat("EUN1_2", win=False),
            _spine_stat("EUN1_3"),
        ],
        matches_analyzed=3,
    )

    per_match = results.get("per_match")
    assert per_match is not None
    assert [entry.get("win") for entry in per_match] == [True, False, None]


"""Duplicated as TRIM_FIXTURES in scope-aggregates.test.ts and kept identical
by hand: the implementations must agree or the stored All-scope figure and the
client's slices drift. n=10 is the smallest input that trims; the n=5 fixture
is asymmetric on purpose, so a trim wrongly applied below ten values fails."""
TRIM_FIXTURES: list[tuple[list[float], float]] = [
    ([0.0, 0.4, 0.45, 0.5, 0.5, 0.5, 0.55, 0.55, 0.6, 1.0], 0.50625),
    ([0.0, 0.5, 0.5, 0.5, 0.9], 0.48),
]


@pytest.mark.parametrize(("values", "expected"), TRIM_FIXTURES)
def test_trimmed_mean_matches_the_shared_fixtures(
    values: list[float], expected: float
) -> None:
    assert analysis_service_module.trimmed_mean(values) == pytest.approx(expected)


def test_headline_averages_trim_the_extreme_matches() -> None:
    """One 0%-winrate side in ten matches should not drag the headline the
    way a plain mean lets it."""
    stats = [
        _spine_stat(f"EUN1_{i}", team_avg=wr, enemy_avg=0.5)
        for i, wr in enumerate(TRIM_FIXTURES[0][0])
    ]
    results = _completion_results(stats, matches_analyzed=100)

    # Exact, not approx: `round(trimmed, 4)` is deterministic, and a loose
    # tolerance here could never catch a one-ulp rounding regression.
    assert results["team_avg_winrate"] == 0.5062


def test_per_match_performance_survives_decimal_inputs_into_json() -> None:
    """kda and the two ratios are NUMERIC columns: SQLAlchemy hands back
    Decimals, and one leaking into the results payload fails JSON
    serialization at finalize -- after the run's API work is already spent."""
    from decimal import Decimal

    perf = analysis_service_module.player_performance_from_rows(
        [
            (Decimal("3.50"), Decimal("0.6120"), Decimal("0.2005")),
            (Decimal("1.25"), None, None),
            (Decimal("2.00"), Decimal("0.5000"), Decimal("0.1800")),
        ]
    )
    assert perf is not None
    assert perf.kda == pytest.approx(2.0)  # median, not mean
    assert perf.kill_participation == pytest.approx(0.556)
    assert perf.damage_share == pytest.approx(0.19025)

    side = analysis_service_module.side_performance([perf])
    results = _completion_results(
        [
            _spine_stat(
                team_kda=side.kda,
                enemy_kda=None,
                team_kill_participation=side.kill_participation,
                team_damage_share=side.damage_share,
            )
        ],
        matches_analyzed=3,
    )
    import json

    payload = json.dumps(results)
    assert '"team_kda": 2.0' in payload
    assert '"enemy_kda": null' in payload


def test_a_side_metric_skips_only_the_players_missing_it() -> None:
    """Old stored games lack the ratio columns; that player still counts
    toward the side's KDA instead of dragging the ratios to zero."""
    with_ratios = analysis_service_module.PlayerPerformance(
        kda=4.0, kill_participation=0.5, damage_share=0.2
    )
    without_ratios = analysis_service_module.PlayerPerformance(
        kda=2.0, kill_participation=None, damage_share=None
    )
    side = analysis_service_module.side_performance([with_ratios, without_ratios])

    assert side.kda == pytest.approx(3.0)
    assert side.kill_participation == pytest.approx(0.5)
    assert side.damage_share == pytest.approx(0.2)
    assert analysis_service_module.player_performance_from_rows([]) is None


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


def test_per_match_carries_both_sides_puuids_for_rank_scoping() -> None:
    """The client re-slices ranks per scope from these lists plus player_ranks."""
    results = _completion_results(
        [
            _spine_stat(
                "EUN1_1",
                ally_puuids=["partner"],
                enemy_puuids=["foe1", "foe2"],
            )
        ],
        matches_analyzed=10,
    )

    per_match = results.get("per_match")
    assert per_match is not None
    assert per_match[0].get("ally_puuids") == ["partner"]
    assert per_match[0].get("enemy_puuids") == ["foe1", "foe2"]
    assert results.get("player_ranks") == {}


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


def _gold_entry(lp: int = 40) -> LeagueEntryDTO:
    return LeagueEntryDTO(
        queue_type="RANKED_SOLO_5x5",
        tier=Tier.GOLD,
        rank=Division.II,
        league_points=lp,
        wins=50,
        losses=50,
    )


async def test_route_threads_non_default_params_into_the_service() -> None:
    """A chosen preset and end date must reach start_analysis, not defaults."""
    service = MagicMock(spec=MatchmakingAnalysisService)
    service.start_analysis.return_value = _analysis()

    await analysis_router.start_analysis(
        request=_request(),
        payload=MatchmakingAnalysisRequest(
            puuid=_PUUID, match_count=30, end_date=date(2026, 7, 26)
        ),
        service=cast(MatchmakingAnalysisService, service),
    )

    service.start_analysis.assert_awaited_once_with(
        _PUUID, MatchmakingAnalysisParams(match_count=30, end_date=date(2026, 7, 26))
    )


async def test_a_fresh_snapshot_resolves_a_rank_without_a_league_call() -> None:
    service = _bare_service()
    service._find_rank_snapshot = AsyncMock(
        return_value=SimpleNamespace(tier="GOLD", rank="II", league_points=40)
    )
    service._api_call_with_retries = AsyncMock()

    await service._cached_player_rank("p1")

    assert service._rank_values["p1"] == rank_value("GOLD", "II", 40)
    assert service._rank_period_accurate == 1
    assert service._rank_current_day == 0
    service._api_call_with_retries.assert_not_awaited()


async def test_a_live_read_near_the_backdated_window_counts_period_accurate() -> None:
    """The counter must match how a rerun will judge the stored snapshot."""
    service = _bare_service()
    service.end_date = datetime.now(UTC).date() - timedelta(days=2)
    service._find_rank_snapshot = AsyncMock(return_value=None)
    service._api_call_with_retries = AsyncMock(return_value=[_gold_entry()])
    service._store_rank_snapshot = AsyncMock()

    await service._cached_player_rank("p1")

    assert service._rank_period_accurate == 1
    assert service._rank_current_day == 0
    service._store_rank_snapshot.assert_awaited_once()


async def test_a_live_read_far_from_the_backdated_window_counts_current_day() -> None:
    service = _bare_service()
    service.end_date = datetime.now(UTC).date() - timedelta(days=60)
    service._find_rank_snapshot = AsyncMock(return_value=None)
    service._api_call_with_retries = AsyncMock(return_value=[_gold_entry()])
    service._store_rank_snapshot = AsyncMock()

    await service._cached_player_rank("p1")

    assert service._rank_period_accurate == 0
    assert service._rank_current_day == 1


async def test_snapshot_window_is_a_day_back_for_latest_runs() -> None:
    service = _bare_service()
    execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=lambda: None))
    service.db = cast(AsyncSession, SimpleNamespace(execute=execute))

    await service._find_rank_snapshot("p1")

    assert execute.await_args is not None
    statement = execute.await_args.args[0]
    bounds = [v for v in _compiled_values(statement) if isinstance(v, datetime)]
    assert len(bounds) == 2
    assert max(bounds) - min(bounds) == RANK_SNAPSHOT_MAX_AGE


async def test_snapshot_window_straddles_the_backdated_reference() -> None:
    service = _bare_service()
    service.end_date = date(2026, 7, 26)
    execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=lambda: None))
    service.db = cast(AsyncSession, SimpleNamespace(execute=execute))

    await service._find_rank_snapshot("p1")

    assert execute.await_args is not None
    statement = execute.await_args.args[0]
    bounds = [v for v in _compiled_values(statement) if isinstance(v, datetime)]
    assert len(bounds) == 2
    assert max(bounds) - min(bounds) == 2 * HISTORICAL_RANK_WINDOW


async def test_store_rank_snapshot_skips_tracked_players() -> None:
    """Match Fetcher owns tracked players' cadence; see `match_lp.py`."""
    service = _bare_service()
    execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=lambda: True))
    service.db = cast(AsyncSession, SimpleNamespace(execute=execute))

    await service._store_rank_snapshot("p1", _gold_entry())

    # Only the tracked probe ran; no insert statement followed it.
    assert execute.await_count == 1


async def test_store_rank_snapshot_skips_an_identical_latest_row() -> None:
    service = _bare_service()
    entry = _gold_entry()
    identical = SimpleNamespace(
        tier="GOLD", rank="II", league_points=40, wins=50, losses=50
    )
    execute = AsyncMock(
        side_effect=[
            MagicMock(scalar_one_or_none=lambda: None),
            MagicMock(scalar_one_or_none=lambda: identical),
        ]
    )
    service.db = cast(AsyncSession, SimpleNamespace(execute=execute))

    await service._store_rank_snapshot("p1", entry)

    # Tracked probe and latest-snapshot read only; no insert statement.
    assert execute.await_count == 2


async def test_store_rank_snapshot_inserts_a_changed_rank(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _bare_service()
    monkeypatch.setattr(
        analysis_service_module,
        "ensure_riot_writer_maintenance_is_inactive",
        AsyncMock(),
    )
    execute = AsyncMock(
        side_effect=[
            MagicMock(scalar_one_or_none=lambda: None),
            MagicMock(scalar_one_or_none=lambda: None),
            MagicMock(),
        ]
    )
    commit = AsyncMock()
    service.db = cast(AsyncSession, SimpleNamespace(execute=execute, commit=commit))

    await service._store_rank_snapshot("p1", _gold_entry())

    # The write is an INSERT ... FROM SELECT re-checking the tracked flag at
    # insert time, so a tracking activation racing the earlier probe cannot
    # land an analysis-time snapshot for a tracked player.
    inserted = execute.await_args_list[2].args[0]
    assert isinstance(inserted, Insert)
    assert "core.players" in str(inserted.compile())
    commit.assert_awaited_once()
