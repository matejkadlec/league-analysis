"""Matchmaking-analysis lifecycle regressions."""

import asyncio
from collections.abc import AsyncGenerator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import Insert, Select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import ClauseElement
from starlette.requests import Request

from app.core.enums import Division, Tier
from app.core.riot_api.client import RiotAPIClient
from app.core.riot_api.constants import Platform, Region
from app.core.riot_api.errors import (
    AuthenticationError,
    BadRequestError,
    ForbiddenError,
    NotFoundError,
    RiotAPIError,
    ServiceUnavailableError,
)
from app.core.riot_api.models import LeagueEntryDTO
from app.features.matchmaking_analysis import router as analysis_router
from app.features.matchmaking_analysis import service as analysis_service_module
from app.features.matchmaking_analysis.errors import MatchmakingAnalysisRuntimeError
from app.features.matchmaking_analysis.models import (
    MatchmakingAnalysis,
    ParticipantSampleJSON,
)
from app.features.matchmaking_analysis.ranks import rank_value, summarize_ranks
from app.features.matchmaking_analysis.schemas import (
    MATCH_COUNT,
    MatchmakingAnalysisParams,
    MatchmakingAnalysisRequest,
)
from app.features.matchmaking_analysis.service import (
    HISTORICAL_RANK_WINDOW,
    MATCHES_FOR_WINRATE,
    MAX_DEGRADED_PLAYER_SHARE,
    MIN_WINRATE_SAMPLE_AFTER_FAILED_FETCH,
    RANK_SNAPSHOT_MAX_AGE,
    MatchmakingAnalysisService,
    SpineAnchor,
)
from app.features.matchmaking_analysis.statistics import (
    PlayerPerformance,
    SpineMatchStats,
    build_completion_results,
    player_performance_from_rows,
    side_performance,
    trimmed_mean,
)

# The account these tests act as. Every stored run belongs to one, so a service
# cannot be built without saying which.
_USER_ID = 7
# The spine match a participant's win rate is sampled at, in the win-rate tests.
_ANCHOR = SpineAnchor("EUN1_SPINE", 1_786_100_000)

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
            participant_samples=None,
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
    monkeypatch.setattr(
        analysis_service_module, "run_lease_is_held", AsyncMock(return_value=False)
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


async def test_status_poll_resumes_a_run_whose_worker_did_not_survive(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A deploy mid-run cancels the task but keeps the row active; the poll
    is the only caller left that can re-arm it."""
    monkeypatch.setattr(
        analysis_service_module, "run_lease_is_held", AsyncMock(return_value=False)
    )
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


async def test_a_status_poll_does_not_start_a_second_worker_while_one_is_alive_elsewhere(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """This process's registry is empty, but another process's worker holds
    the run's lease: the poll leaves the run to it (LGA-129)."""
    lease_check = AsyncMock(return_value=True)
    monkeypatch.setattr(analysis_service_module, "run_lease_is_held", lease_check)
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
    service._ensure_background_task.assert_not_called()
    lease_check.assert_awaited_once_with(database, _USER_ID, _PUUID, active.created_at)


async def test_a_worker_that_cannot_take_the_lease_does_no_work(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Two processes can both pass the poll's check; only one worker runs."""

    @asynccontextmanager
    async def taken_lease(*_args: object) -> AsyncGenerator[bool]:
        yield False

    monkeypatch.setattr(analysis_service_module, "hold_run_lease", taken_lease)
    service = _bare_service()
    service._run_leased_analysis = AsyncMock()

    await service._run_analysis_background(_PUUID, datetime.now(UTC))

    service._run_leased_analysis.assert_not_awaited()


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
    service._region = Region.EUROPE

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
) -> SpineMatchStats:
    """One spine match whose per-side aggregates resolve to the given values.

    Samples sit under synthetic per-match puuids, so they never recur across
    matches and the duo-partner exclusion cannot swallow them."""

    def side(
        avg: float | None, kda: float | None, kp: float | None, ds: float | None
    ) -> tuple[dict[str, float], dict[str, PlayerPerformance]]:
        winrates = {} if avg is None else {f"wr-{match_id}": avg}
        performances = (
            {}
            if kda is None
            else {
                f"perf-{match_id}": PlayerPerformance(
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
    return SpineMatchStats(
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
    spine_stats: list[SpineMatchStats],
    matches_analyzed: int = 0,
) -> analysis_service_module.MatchmakingAnalysisResultsJSON:
    return build_completion_results(
        spine_stats,
        matches_analyzed=matches_analyzed,
        matches_requested=10,
        rank_summary=summarize_ranks(set(), set(), {}, {}),
        player_ranks={},
        rank_period_accurate=0,
        rank_current_day=0,
        degraded_players=0,
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
    spine_stats: list[SpineMatchStats],
) -> None:
    """0.0% vs 0.0% used to be written as a fair-matchmaking verdict.

    Every spine match failing to load returns None from the optional fetch, so
    both averages fell back to 0.0 and the run was still stamped `completed`.
    The failure path already persists a terminal diagnostic.
    """
    with pytest.raises(MatchmakingAnalysisRuntimeError):
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
) -> SpineMatchStats:
    return SpineMatchStats(
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
    assert trimmed_mean(values) == pytest.approx(expected)


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

    perf = player_performance_from_rows(
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

    side = side_performance([perf])
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
    with_ratios = PlayerPerformance(kda=4.0, kill_participation=0.5, damage_share=0.2)
    without_ratios = PlayerPerformance(
        kda=2.0, kill_participation=None, damage_share=None
    )
    side = side_performance([with_ratios, without_ratios])

    assert side.kda == pytest.approx(3.0)
    assert side.kill_participation == pytest.approx(0.5)
    assert side.damage_share == pytest.approx(0.2)
    assert player_performance_from_rows([]) is None


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
    from app.features.auth.users.models import User
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


class _RecordingRiot:
    """Answers every participant read with nothing, and records who was read."""

    def __init__(self) -> None:
        self.match_lists: list[str] = []
        self.league_reads: list[str] = []

    async def get_match_list_by_puuid(
        self, *, puuid: str, **_kwargs: object
    ) -> SimpleNamespace:
        self.match_lists.append(puuid)
        return SimpleNamespace(match_ids=[])

    async def get_league_entries_by_puuid(
        self, puuid: str, **_kwargs: object
    ) -> list[LeagueEntryDTO]:
        self.league_reads.append(puuid)
        return []


def _empty_result() -> SimpleNamespace:
    """What the stubbed database answers to every read: nothing stored."""
    return SimpleNamespace(
        tuples=lambda: SimpleNamespace(all=list),
        scalar_one_or_none=lambda: None,
    )


async def test_a_resumed_run_does_not_refetch_players_already_marked_done(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Players a dead worker finished come back from the row, not from Riot.

    The resumed worker used to read them again while the bar already showed
    them done (LGA-129); only the unfinished enemy costs Riot calls here.
    """
    monkeypatch.setattr(
        analysis_service_module,
        "ensure_riot_writer_maintenance_is_inactive",
        AsyncMock(),
    )
    progress_writes: list[dict[str, bool]] = []

    async def execute(statement: ClauseElement) -> SimpleNamespace:
        progress = (statement.compile().params or {}).get("puuid_progress")
        if progress is not None:
            progress_writes.append(dict(progress))
        return _empty_result()

    riot = _RecordingRiot()
    service = MatchmakingAnalysisService(
        cast(AsyncSession, SimpleNamespace(execute=execute, commit=AsyncMock())),
        cast(RiotAPIClient, riot),
        _USER_ID,
    )
    service._region = Region.EUROPE
    lobby = [(_PUUID, 100), ("done-ally", 100), ("fresh-enemy", 200)]
    service._get_match_participants = AsyncMock(return_value=lobby)
    service._get_win_status = AsyncMock(return_value=True)
    run = _analysis("in_progress")
    stored_progress = {
        f"{_PUUID}:EUW1_0": True,
        "done-ally:EUW1_0": True,
        "fresh-enemy:EUW1_0": False,
    }
    run.puuid_progress = dict(stored_progress)
    done_ally: ParticipantSampleJSON = {
        "winrate": 0.4,
        "sample_match_ids": ["EUW1_7", "EUW1_8"],
        "rank_value": 1240,
        "rank_tier": "GOLD",
        "rank_basis": "period_accurate",
        "degraded": True,
    }
    run.participant_samples = {
        _PUUID: {
            "winrate": 0.6,
            "sample_match_ids": ["EUW1_9"],
            "rank_value": None,
            "rank_tier": "UNRANKED",
            "rank_basis": None,
            "degraded": False,
        },
        "done-ally": done_ally,
    }
    service._get_analysis = AsyncMock(return_value=run)

    await service._initialize_progress_keys(_PUUID, run.created_at, ["EUW1_0"])
    stats = await service._sample_spine_match(
        _PUUID,
        run.created_at,
        SpineAnchor("EUW1_0", 1_786_100_000),
        Platform.EUW1,
    )

    assert riot.match_lists == ["fresh-enemy"]
    assert riot.league_reads == ["fresh-enemy"]
    assert stats is not None
    assert stats.ally_winrates == {_PUUID: 0.6, "done-ally": 0.4}
    assert service._rank_tiers["done-ally"] == "GOLD"
    assert service._rank_period_accurate == 1
    assert service._degraded_players == {"done-ally"}
    assert service.matches_analyzed == 3
    assert progress_writes[0] == stored_progress
    assert progress_writes[-1]["fresh-enemy:EUW1_0"] is True


async def test_a_restored_player_left_off_the_new_spine_is_not_counted() -> None:
    """A restart can shift a latest-matches spine; a sample whose player is no
    longer in it must not add their matches to the run."""
    service = _bare_service()
    gone: ParticipantSampleJSON = {
        "winrate": 0.5,
        "sample_match_ids": ["EUW1_1", "EUW1_2"],
        "rank_value": None,
        "rank_tier": "UNRANKED",
        "rank_basis": None,
        "degraded": False,
    }

    restored = service._restore_participant_samples({"gone": gone}, {"still-here"})

    assert restored == set()
    assert service.matches_analyzed == 0
    assert "gone" not in service._winrate_cache


async def test_a_finished_participant_is_marked_done_with_its_sample_in_one_write(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Progress and sample land together, so no key is done without a sample."""
    monkeypatch.setattr(
        analysis_service_module,
        "ensure_riot_writer_maintenance_is_inactive",
        AsyncMock(),
    )
    database = SimpleNamespace(execute=AsyncMock(), commit=AsyncMock())
    service = MatchmakingAnalysisService(
        cast(AsyncSession, database), cast(RiotAPIClient, object()), _USER_ID
    )
    run = _analysis("in_progress")
    run.puuid_progress = {"ally:EUW1_0": False, "ally:EUW1_1": False, "x:EUW1_0": False}
    service._get_analysis = AsyncMock(return_value=run)
    service._winrate_cache["ally"] = 0.7
    service._winrate_sample_ids["ally"] = ["EUW1_5"]
    service._record_rank("ally", "GOLD", "II", 40, period_accurate=False)

    await service._record_participant_sample(_PUUID, run.created_at, "ally")

    database.execute.assert_awaited_once()
    params = database.execute.await_args.args[0].compile().params
    assert params["puuid_progress"] == {
        "ally:EUW1_0": True,
        "ally:EUW1_1": True,
        "x:EUW1_0": False,
    }
    written: list[object] = [
        value for value in params.values() if isinstance(value, dict)
    ]
    assert {
        "ally": {
            "winrate": 0.7,
            "sample_match_ids": ["EUW1_5"],
            "rank_value": rank_value("GOLD", "II", 40),
            "rank_tier": "GOLD",
            "rank_basis": "current_day",
            "degraded": False,
        }
    } in written


async def test_resume_clears_a_stale_rate_limit_reset_at(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A worker that died while waiting left a reset time behind; the resumed
    worker is not waiting, so `in_progress` must not carry it (LGA-129)."""
    monkeypatch.setattr(
        analysis_service_module,
        "ensure_riot_writer_maintenance_is_inactive",
        AsyncMock(),
    )
    database = SimpleNamespace(execute=AsyncMock(), commit=AsyncMock())
    service = MatchmakingAnalysisService(
        cast(AsyncSession, database), cast(RiotAPIClient, object()), _USER_ID
    )

    await service._mark_analysis_in_progress(_PUUID, datetime.now(UTC))

    params = database.execute.await_args.args[0].compile().params
    assert params["status"] == "in_progress"
    assert "rate_limit_reset_at" in params
    assert params["rate_limit_reset_at"] is None


async def test_spine_fetch_uses_the_runs_count_and_end_time() -> None:
    service = _bare_service()
    service.match_count = 20
    service.end_date = datetime(2026, 7, 26, tzinfo=UTC).date()
    service._api_fetch_match_ids = AsyncMock(return_value=[f"m{i}" for i in range(20)])

    result = await service._load_spine_match_ids(_PUUID, datetime.now(UTC))

    assert result is not None
    assert len(result) == 20
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

    assert result is not None
    assert len(result) == 12
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
    """A chosen end date must reach start_analysis, not the default."""
    expected = _analysis()
    service = MagicMock(spec=MatchmakingAnalysisService)
    service.start_analysis.return_value = expected

    result = await analysis_router.start_analysis(
        request=_request(),
        payload=MatchmakingAnalysisRequest(puuid=_PUUID, end_date=date(2026, 7, 26)),
        service=cast(MatchmakingAnalysisService, service),
    )

    service.start_analysis.assert_awaited_once_with(
        _PUUID,
        MatchmakingAnalysisParams(match_count=MATCH_COUNT, end_date=date(2026, 7, 26)),
    )
    assert result is expected


async def test_a_fresh_snapshot_resolves_a_rank_without_a_league_call() -> None:
    service = _bare_service()
    service._find_rank_snapshot = AsyncMock(
        return_value=SimpleNamespace(tier="GOLD", rank="II", league_points=40)
    )
    service._api_call_with_retries = AsyncMock()

    await service._cached_player_rank("p1", Platform.EUN1)

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

    await service._cached_player_rank("p1", Platform.EUN1)

    assert service._rank_period_accurate == 1
    assert service._rank_current_day == 0
    service._store_rank_snapshot.assert_awaited_once()


async def test_a_live_read_far_from_the_backdated_window_counts_current_day() -> None:
    service = _bare_service()
    service.end_date = datetime.now(UTC).date() - timedelta(days=60)
    service._find_rank_snapshot = AsyncMock(return_value=None)
    service._api_call_with_retries = AsyncMock(return_value=[_gold_entry()])
    service._store_rank_snapshot = AsyncMock()

    await service._cached_player_rank("p1", Platform.EUN1)

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

    # A count would only say how many statements ran: an INSERT put in place of
    # the probe keeps it at one. Assert which statement was executed.
    executed: list[ClauseElement] = [call.args[0] for call in execute.await_args_list]
    assert len(executed) == 1
    probe = executed[0]
    bound = _compiled_values(probe)
    assert isinstance(probe, Select)
    assert "core.players" in str(probe.compile())
    assert "p1" in bound


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

    # Tracked probe and latest-snapshot read only. A count cannot say that: an
    # INSERT swapped in for either read keeps it at two.
    executed: list[ClauseElement] = [call.args[0] for call in execute.await_args_list]
    assert len(executed) == 2
    assert all(isinstance(statement, Select) for statement in executed)
    assert "core.player_leagues" in str(executed[1].compile())


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


def _winrate_service(
    stored_rows: list[tuple[str, bool]], list_error: Exception
) -> MatchmakingAnalysisService:
    """A routed service whose database holds `stored_rows` for the participant
    and whose match-ID list call fails with `list_error`."""
    stored = SimpleNamespace(tuples=lambda: SimpleNamespace(all=lambda: stored_rows))
    riot_client = SimpleNamespace(
        get_match_list_by_puuid=AsyncMock(side_effect=list_error)
    )
    service = MatchmakingAnalysisService(
        cast(AsyncSession, SimpleNamespace(execute=AsyncMock(return_value=stored))),
        cast(RiotAPIClient, riot_client),
        _USER_ID,
    )
    service._region = Region.EUROPE
    return service


@pytest.mark.parametrize(
    "failure",
    [
        ServiceUnavailableError("upstream", status_code=503),
        RiotAPIError("Request failed"),
        BadRequestError("bad request", status_code=400),
    ],
    ids=["503-after-retries", "network-timeout", "400"],
)
async def test_a_transient_failure_never_yields_a_one_match_winrate(
    failure: Exception,
) -> None:
    """A failed match-ID list leaves one stored earlier game to count.

    One game is 100% or 0% (when the spine match still counted, it was a win
    for every ally of a won match and a loss for every enemy), so the run
    used to report 100% against 0% and call itself complete.
    """
    service = _winrate_service([("EUN1_SPINE", True), ("EUN1_EARLIER", True)], failure)

    winrate = await service._cached_player_winrate("ally", _ANCHOR)

    assert winrate is None
    assert "ally" not in service._winrate_sample_ids
    assert service.matches_analyzed == 0


async def test_a_failed_list_call_keeps_a_winrate_that_rests_on_enough_matches() -> (
    None
):
    """The stated minimum, from the other side: enough stored games still count."""
    rows = [
        (f"EUN1_{index}", index % 2 == 0)
        for index in range(MIN_WINRATE_SAMPLE_AFTER_FAILED_FETCH)
    ]
    service = _winrate_service(rows, ServiceUnavailableError("upstream"))

    winrate = await service._cached_player_winrate("ally", _ANCHOR)

    assert winrate == pytest.approx(3 / 5)
    assert service.matches_analyzed == MIN_WINRATE_SAMPLE_AFTER_FAILED_FETCH


async def test_a_player_riot_has_no_history_for_is_not_a_failure() -> None:
    """A 404 is an answer: the stored earlier game is all there is, and it
    counts. The stored spine match does not: it is the game being judged."""
    service = _winrate_service(
        [("EUN1_SPINE", True), ("EUN1_EARLIER", False)], NotFoundError("no matches")
    )

    winrate = await service._cached_player_winrate("ally", _ANCHOR)

    assert winrate == pytest.approx(0.0)
    assert service._winrate_sample_ids["ally"] == ["EUN1_EARLIER"]
    assert service.optional_fetch_failures == 0


@pytest.mark.parametrize("spine_position", [0, 4, 10], ids=["first", "middle", "last"])
async def test_the_spine_match_never_counts_in_a_stored_sample(
    spine_position: int,
) -> None:
    """LGA-140: a participant's ten matches are the ones before the game being
    judged. Counting it moved every gap by about 10 pp x (2p - 1), where p is
    the analyzed player's own spine win rate. Eleven are read, so a full
    sample remains wherever the spine match sorts."""
    earlier = [(f"EUN1_{index}", False) for index in range(MATCHES_FOR_WINRATE)]
    stored = [
        *earlier[:spine_position],
        ("EUN1_SPINE", True),
        *earlier[spine_position:],
    ]
    service = _winrate_service(stored, AssertionError("the database was enough"))

    winrate = await service._cached_player_winrate("ally", _ANCHOR)

    assert winrate == pytest.approx(0.0)
    assert service._winrate_sample_ids["ally"] == [mid for mid, _ in earlier]
    assert service.matches_analyzed == MATCHES_FOR_WINRATE


async def test_the_spine_match_never_counts_in_a_sample_read_from_riot() -> None:
    """The API path drops it the same way, after asking for one match more."""
    earlier = [f"EUN1_{index}" for index in range(MATCHES_FOR_WINRATE)]
    match_list = AsyncMock(
        return_value=SimpleNamespace(match_ids=["EUN1_SPINE", *earlier])
    )
    service = MatchmakingAnalysisService(
        cast(
            AsyncSession,
            SimpleNamespace(
                execute=AsyncMock(
                    return_value=SimpleNamespace(
                        tuples=lambda: SimpleNamespace(all=list)
                    )
                )
            ),
        ),
        cast(RiotAPIClient, SimpleNamespace(get_match_list_by_puuid=match_list)),
        _USER_ID,
    )
    service._region = Region.EUROPE
    asked: list[str] = []

    async def win_status(match_id: str, _puuid: str) -> bool:
        asked.append(match_id)
        return match_id == "EUN1_SPINE"

    service._get_win_status = AsyncMock(side_effect=win_status)

    winrate = await service._cached_player_winrate("ally", _ANCHOR)

    assert match_list.await_args is not None
    assert match_list.await_args.kwargs["count"] == MATCHES_FOR_WINRATE + 1
    assert match_list.await_args.kwargs["end_time"] == _ANCHOR.end_time_seconds
    assert asked == earlier
    assert winrate == pytest.approx(0.0)


async def test_a_participant_whose_read_failed_is_counted_as_degraded() -> None:
    service = _bare_service()

    async def failing_winrate(*_args: object) -> None:
        service.optional_fetch_failures += 1

    service._cached_player_winrate = AsyncMock(side_effect=failing_winrate)
    service._cached_player_performance = AsyncMock(return_value=None)
    service._cached_player_rank = AsyncMock()
    service._record_participant_sample = AsyncMock()
    side = analysis_service_module.SideSamples({}, {})

    await service._sample_participant(
        side, "unread", _ANCHOR, Platform.EUN1, _PUUID, datetime.now(UTC)
    )
    service._cached_player_winrate = AsyncMock(return_value=0.5)
    await service._sample_participant(
        side, "read", _ANCHOR, Platform.EUN1, _PUUID, datetime.now(UTC)
    )

    assert service._degraded_players == {"unread"}


def _service_with_degraded(degraded: int, sampled: int) -> MatchmakingAnalysisService:
    service = _bare_service()
    players = [f"p{index}" for index in range(sampled)]
    service._ally_rank_puuids = set(players)
    service._degraded_players = set(players[:degraded])
    return service


def test_a_degraded_run_is_not_stored_as_a_clean_completed_result() -> None:
    """Past the agreed share the run fails as retryable instead of completing.

    One more degraded participant than the share allows out of 91, the lobby
    of a ten-match run.
    """
    over = int(91 * MAX_DEGRADED_PLAYER_SHARE) + 1
    service = _service_with_degraded(over, 91)

    with pytest.raises(MatchmakingAnalysisRuntimeError) as caught:
        service._refuse_a_mostly_degraded_run()

    assert caught.value.code == "riot_service_error"


def test_a_lightly_degraded_run_completes_and_says_how_many_it_missed() -> None:
    within = int(91 * MAX_DEGRADED_PLAYER_SHARE)
    service = _service_with_degraded(within, 91)

    service._refuse_a_mostly_degraded_run()
    results = build_completion_results(
        [_spine_stat()],
        matches_analyzed=10,
        matches_requested=10,
        rank_summary=summarize_ranks(set(), set(), {}, {}),
        player_ranks={},
        rank_period_accurate=0,
        rank_current_day=0,
        degraded_players=len(service._degraded_players),
        analyzed_puuid="analyzed",
    )

    assert results.get("degraded_players") == within


def _detail_failure_service(failure: Exception) -> MatchmakingAnalysisService:
    """The match-ID list answers with the spine match and ten earlier games;
    every detail fetch fails.

    The spine match and one earlier game are stored, so the real
    `_get_win_status` finds that game and has to ask Riot for the other nine.
    """
    match_ids = ["EUN1_SPINE", *(f"EUN1_{index}" for index in range(10))]
    stored = {"EUN1_SPINE": True, "EUN1_0": True}

    async def execute(statement: ClauseElement) -> SimpleNamespace:
        asked = set(_compiled_values(statement))
        stored_win = next((stored[mid] for mid in stored if mid in asked), None)
        return SimpleNamespace(
            tuples=lambda: SimpleNamespace(all=lambda: list(stored.items())),
            scalar_one_or_none=lambda: stored_win,
        )

    riot_client = SimpleNamespace(
        get_match_list_by_puuid=AsyncMock(
            return_value=SimpleNamespace(match_ids=match_ids)
        ),
        get_match=AsyncMock(side_effect=failure),
    )
    service = MatchmakingAnalysisService(
        cast(AsyncSession, SimpleNamespace(execute=execute)),
        cast(RiotAPIClient, riot_client),
        _USER_ID,
    )
    service._region = Region.EUROPE
    return service


@pytest.mark.parametrize(
    "failure",
    [ServiceUnavailableError("upstream", status_code=503), RiotAPIError("timeout")],
    ids=["503-after-retries", "network-timeout"],
)
async def test_failed_match_details_never_leave_a_one_match_winrate(
    failure: Exception,
) -> None:
    """The other path to the same figure: the list arrives, the games do not."""
    service = _detail_failure_service(failure)

    winrate = await service._cached_player_winrate("ally", _ANCHOR)

    assert winrate is None
    assert "ally" not in service._winrate_sample_ids
    assert service.matches_analyzed == 0
    assert service.optional_fetch_failures == 9


_SPINE = [f"EUW1_{index}" for index in range(5)]


@dataclass
class _Run:
    """One stubbed run and what it was seen to do."""

    service: MatchmakingAnalysisService
    results_written: list[object]
    rank_platforms: list[Platform]
    lobbies_read: list[str]


def _lobby(match_id: str) -> list[tuple[str, int]]:
    """The analysed player, four allies and five enemies nobody else meets."""
    allies = [(f"{match_id}-ally-{slot}", 100) for slot in range(4)]
    enemies = [(f"{match_id}-enemy-{slot}", 200) for slot in range(5)]
    return [(_PUUID, 100), *allies, *enemies]


def _run_service(
    monkeypatch: pytest.MonkeyPatch,
    unread: set[str],
    lobby: Callable[[str], list[tuple[str, int]]] = _lobby,
) -> _Run:
    """A whole run over five stored spine matches, with Riot reads stubbed.

    The subject is stored on EUNE and every spine match on EUW, and a read
    fails for each player in `unread`.
    """
    monkeypatch.setattr(
        analysis_service_module,
        "ensure_riot_writer_maintenance_is_inactive",
        AsyncMock(),
    )
    written: list[object] = []
    rank_platforms: list[Platform] = []
    lobbies_read: list[str] = []

    async def execute(statement: ClauseElement) -> SimpleNamespace:
        results = (statement.compile().params or {}).get("results")
        if results is not None:
            written.append(results)
        return SimpleNamespace(
            scalar_one=lambda: "eun1", scalar_one_or_none=lambda: "completed"
        )

    database = SimpleNamespace(execute=execute, commit=AsyncMock())
    service = MatchmakingAnalysisService(
        cast(AsyncSession, database), cast(RiotAPIClient, object()), _USER_ID
    )

    async def winrate(p_puuid: str, *_args: object) -> float:
        if p_puuid in unread:
            service.optional_fetch_failures += 1
        return 0.5

    async def rank(p_puuid: str, platform: Platform) -> None:
        rank_platforms.append(platform)
        service._rank_values[p_puuid] = None

    async def participants(match_id: str) -> list[tuple[str, int]]:
        lobbies_read.append(match_id)
        return lobby(match_id)

    service._get_analysis = AsyncMock(return_value=_analysis())
    service._mark_analysis_in_progress = AsyncMock()
    service._load_spine_match_ids = AsyncMock(return_value=list(_SPINE))
    service._ensure_spine_matches_ready = AsyncMock(return_value=True)
    service._initialize_progress_keys = AsyncMock()
    service._get_game_start_timestamp = AsyncMock(return_value=1_786_100_000_000)
    service._get_match_platform = AsyncMock(return_value=Platform.EUW1)
    service._get_match_participants = AsyncMock(side_effect=participants)
    service._get_win_status = AsyncMock(return_value=True)
    service._cached_player_winrate = AsyncMock(side_effect=winrate)
    service._cached_player_performance = AsyncMock(return_value=None)
    service._cached_player_rank = AsyncMock(side_effect=rank)
    return _Run(service, written, rank_platforms, lobbies_read)


async def test_a_lightly_degraded_run_stores_its_count_and_ranks_by_match_platform(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """2 unread players of 46 is under the share: completed, and it says so."""
    unread = {"EUW1_1-ally-0", "EUW1_3-enemy-2"}
    run = _run_service(monkeypatch, unread)

    await run.service._run_analysis(_PUUID, datetime.now(UTC))

    (results,) = run.results_written
    assert cast(dict[str, object], results)["degraded_players"] == 2
    # Routed by the run itself, and ranks by where each match was played --
    # EUW here -- not by the EUNE the analysed player is stored on.
    assert run.service._region is Region.EUROPE
    assert set(run.rank_platforms) == {Platform.EUW1}


async def test_a_mostly_degraded_run_stops_early_and_stores_no_result(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Nine unread players in the first match already decide a 46-player run.

    Nothing is written as a result, and the other four spine matches are not
    sampled: in an outage each of their reads would wait out its own retries.
    """
    unread = {puuid for puuid, _team in _lobby("EUW1_0")} - {_PUUID}
    run = _run_service(monkeypatch, unread)

    with pytest.raises(MatchmakingAnalysisRuntimeError) as caught:
        await run.service._run_analysis(_PUUID, datetime.now(UTC))

    assert caught.value.code == "riot_service_error"
    assert run.results_written == []
    assert run.lobbies_read == ["EUW1_0"]


async def test_the_share_is_of_the_players_actually_met_not_of_the_most_possible(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The same nine others in all five matches: 2 unread of 10 is a fifth.

    The mid-run check measures against the 46 a five-match spine could hold and
    lets this through, so the refusal has to come from the one at the end.
    """
    run = _run_service(
        monkeypatch,
        {"EUW1_0-ally-0", "EUW1_0-enemy-0"},
        lobby=lambda _match_id: _lobby("EUW1_0"),
    )

    with pytest.raises(MatchmakingAnalysisRuntimeError) as caught:
        await run.service._run_analysis(_PUUID, datetime.now(UTC))

    assert caught.value.code == "riot_service_error"
    assert run.results_written == []
    assert run.lobbies_read == _SPINE
