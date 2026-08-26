"""The computed fields every matchmaking status/history response serialises."""

from datetime import date

import pytest
from pydantic import ValidationError

from app.features.matchmaking_analysis.schemas import (
    MatchmakingAnalysisHistoryItem,
    MatchmakingAnalysisParams,
    MatchmakingAnalysisRequest,
    MatchmakingAnalysisResponse,
    MatchmakingAnalysisResults,
)


def response(**overrides: object) -> MatchmakingAnalysisResponse:
    payload: dict[str, object] = {
        "puuid": "p-1",
        "created_at": "2026-08-19T10:00:00Z",
        "status": "in_progress",
        **overrides,
    }
    return MatchmakingAnalysisResponse.model_validate(payload)


def test_progress_counts_only_the_puuids_actually_finished() -> None:
    # The frontend draws its progress bar from progress/total_puuids. Counting
    # keys instead of completed values reports 100% the moment the work is
    # enumerated, before a single player has been analysed.
    r = response(puuid_progress={"a": True, "b": False, "c": True, "d": False})

    assert r.progress == 2
    assert r.total_puuids == 4


def test_an_unstarted_analysis_reports_zero_of_zero() -> None:
    r = response(puuid_progress=None)

    assert r.progress == 0
    assert r.total_puuids == 0
    # And the computed pair actually serialises — it is @computed_field, not a
    # property the response quietly drops.
    dumped = r.model_dump()
    assert dumped["progress"] == 0
    assert dumped["total_puuids"] == 0


def test_the_map_nothing_reads_stays_off_the_wire() -> None:
    # `puuid_progress` is the field that used to make `/status` a second,
    # near-identical response schema. It still feeds the two computed fields;
    # it just no longer ships.
    dumped = response(puuid_progress={"a": True}).model_dump()

    assert "puuid_progress" not in dumped
    assert dumped["progress"] == 1


def test_a_completed_run_missing_a_winrate_is_rejected_not_zero_filled() -> None:
    # `/status` validates every row through the response, so a blob missing one
    # of the three required keys fails loudly instead of rendering as a 0%
    # winrate the response's own `ge=0.0, le=1.0` bound cannot reject.
    with pytest.raises(ValidationError):
        response(
            status="completed",
            results={"team_avg_winrate": 0.5, "matches_analyzed": 10},
        )


def test_gap_is_positive_when_the_players_team_was_favoured() -> None:
    # The history card prints |gap| and encodes the *sign* as colour alone, so
    # this subtraction order is the only thing saying which side was stronger.
    item = MatchmakingAnalysisHistoryItem.model_validate(
        {
            "created_at": "2026-08-19T10:00:00Z",
            "team_avg_winrate": 0.55,
            "enemy_avg_winrate": 0.50,
        }
    )

    assert item.gap == pytest.approx(0.05)
    assert item.model_dump()["gap"] == pytest.approx(0.05)


def test_winrates_are_fractions_not_percentages() -> None:
    # A 0-100 value slipping in here renders as 5500% on the results card.
    with pytest.raises(ValidationError):
        MatchmakingAnalysisResults(
            team_avg_winrate=55.0, enemy_avg_winrate=0.5, matches_analyzed=10
        )
    with pytest.raises(ValidationError):
        MatchmakingAnalysisResults(
            team_avg_winrate=0.5, enemy_avg_winrate=-0.1, matches_analyzed=10
        )


def test_request_bounds_reject_out_of_range_match_counts() -> None:
    # 5-30 is the backend contract; the UI presets (10/20/30) are a subset.
    with pytest.raises(ValidationError):
        MatchmakingAnalysisRequest(puuid="p-1", match_count=4)
    with pytest.raises(ValidationError):
        MatchmakingAnalysisRequest(puuid="p-1", match_count=31)
    assert MatchmakingAnalysisRequest(puuid="p-1").match_count == 10
    assert MatchmakingAnalysisRequest(puuid="p-1").end_date is None


def test_a_legacy_results_blob_parses_with_new_fields_absent_not_zero() -> None:
    # Pre-extension rows carry only the three original keys. Every new field
    # must read back as None -- a 0 here is the "0% average winrate" bug
    # reborn as "average rank Iron IV".
    results = MatchmakingAnalysisResults.model_validate(
        {"team_avg_winrate": 0.5, "enemy_avg_winrate": 0.5, "matches_analyzed": 10}
    )

    assert results.ally_avg_rank_value is None
    assert results.enemy_avg_rank_value is None
    assert results.ally_tier_counts is None
    assert results.per_match is None
    assert results.rank_freshness is None
    assert results.matches_requested is None


def test_an_lga_105_per_match_entry_parses_with_performance_absent() -> None:
    # Runs from the rank/duo extension carry per_match entries without the
    # performance keys; each must read back as None, not 0.00 KDA.
    from app.features.matchmaking_analysis.schemas import (
        MatchmakingPerMatchBreakdown,
    )

    entry = MatchmakingPerMatchBreakdown.model_validate(
        {"match_id": "EUN1_1", "duo": False, "team_avg": 0.5, "enemy_avg": 0.5}
    )

    assert entry.team_kda is None
    assert entry.enemy_kda is None
    assert entry.team_kill_participation is None
    assert entry.enemy_kill_participation is None
    assert entry.team_damage_share is None
    assert entry.enemy_damage_share is None


def test_a_null_params_column_reads_as_the_truthful_legacy_default() -> None:
    # Every run persisted before the params column was a 10-match latest run.
    r = response(params=None)
    assert r.params.match_count == 10
    assert r.params.end_date is None

    item = MatchmakingAnalysisHistoryItem.model_validate(
        {
            "created_at": "2026-08-19T10:00:00Z",
            "team_avg_winrate": 0.55,
            "enemy_avg_winrate": 0.50,
            "params": None,
        }
    )
    assert item.params.match_count == 10


def test_params_round_trip_through_their_json_persistence_shape() -> None:
    # `start_analysis` persists `model_dump(mode="json")`; the worker and the
    # readers re-validate that exact shape.
    params = MatchmakingAnalysisParams.model_validate(
        MatchmakingAnalysisParams(
            match_count=30, end_date=date(2026, 7, 26)
        ).model_dump(mode="json")
    )

    assert params.match_count == 30
    assert params.end_date == date(2026, 7, 26)
