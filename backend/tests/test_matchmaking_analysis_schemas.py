"""The computed fields every matchmaking status/history response serialises."""

import re
from datetime import date, datetime, timedelta, tzinfo
from pathlib import Path
from typing import override

import pytest
from pydantic import ValidationError

from app.features.matchmaking_analysis import schemas as schemas_module
from app.features.matchmaking_analysis.ranks import (
    classify_duo_matches,
    duo_partner_threshold,
)
from app.features.matchmaking_analysis.schemas import (
    MATCH_COUNT,
    MatchmakingAnalysisHistoryItem,
    MatchmakingAnalysisParams,
    MatchmakingAnalysisRequest,
    MatchmakingAnalysisResponse,
    MatchmakingAnalysisResults,
)
from app.features.matchmaking_analysis.service import (
    MAX_DEGRADED_PLAYER_SHARE,
    MIN_MATCHES_FLOOR,
    MIN_WINRATE_SAMPLE_AFTER_FAILED_FETCH,
    league_v4_max_requests,
    match_v5_max_requests,
    theoretical_max_requests,
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


@pytest.mark.parametrize("asked", [MATCH_COUNT - 1, MATCH_COUNT + 1, 30, 100])
def test_a_request_for_any_other_match_count_is_refused(asked: int) -> None:
    # LGA-140: the count is fixed. A client asking for 30 is told so rather
    # than silently handed a 10-match run it did not ask for.
    with pytest.raises(ValidationError):
        MatchmakingAnalysisRequest(puuid="p-1", match_count=asked)


def test_a_request_runs_the_fixed_count_whether_or_not_it_names_it() -> None:
    assert MatchmakingAnalysisRequest(puuid="p-1").match_count == MATCH_COUNT
    named = MatchmakingAnalysisRequest(puuid="p-1", match_count=MATCH_COUNT)
    assert named.match_count == MATCH_COUNT
    assert MatchmakingAnalysisRequest(puuid="p-1").end_date is None


def test_a_stored_run_keeps_the_count_it_ran_with() -> None:
    # Runs from before LGA-140 carry 10 to 100; reading them must not refuse
    # or rewrite the count their history row shows.
    assert MatchmakingAnalysisParams(match_count=30).match_count == 30


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

    assert entry.win is None
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


_DOCUMENTATION = (
    Path(__file__).resolve().parents[2] / "docs" / "matchmaking-analysis.md"
).read_text(encoding="utf-8")
# Prose is matched with its line breaks folded, so re-wrapping a paragraph is
# not drift; the cost table is matched line by line and keeps the original.
_PROSE = " ".join(_DOCUMENTATION.split())


def test_the_documented_count_matches_the_request_schema() -> None:
    # The document said "5-30" for three months after the ceiling moved to 100,
    # and the floor it quoted is the completion floor, a different rule.
    assert f"spine size, **fixed at {MATCH_COUNT}**" in _PROSE, (
        "docs/matchmaking-analysis.md states another match count"
    )
    assert f"**Floor: {MIN_MATCHES_FLOOR} found matches**" in _PROSE


def _number(cell: str) -> int:
    return int(cell.replace(",", ""))


def test_the_documented_cost_table_matches_the_request_formulas() -> None:
    # The start card's duration test reads the same table (LGA-147), so the
    # backend formulas, the frontend estimate and the document cannot drift
    # apart without one side failing.
    rows = re.findall(
        r"^\| (\d+) \| ([\d,]+) \| ([\d,]+) \| ([\d,]+) \| about [^|]+ \|$",
        _DOCUMENTATION,
        re.MULTILINE,
    )

    assert [int(size) for size, *_ in rows] == [MATCH_COUNT]
    for size, match_v5, league_v4, total in rows:
        spine = int(size)
        assert _number(match_v5) == match_v5_max_requests(spine)
        assert _number(league_v4) == league_v4_max_requests(spine)
        assert _number(total) == theoretical_max_requests(spine)


def test_the_documented_degradation_rules_match_the_constants() -> None:
    assert (
        f"kept only if it rests on at least {MIN_WINRATE_SAMPLE_AFTER_FAILED_FETCH} "
        "matches" in _PROSE
    )
    assert (
        f"more than {MAX_DEGRADED_PLAYER_SHARE:.0%} of the participants are degraded"
        in _PROSE
    )


def _spine_meeting(partner: str, times: int, size: int) -> list[tuple[str, list[str]]]:
    spine = [(f"m{index}", [f"stranger-{index}"]) for index in range(size)]
    for index in range(times):
        spine[index] = (f"m{index}", [partner])
    return spine


def test_the_documented_duo_rule_is_the_coded_one() -> None:
    assert (
        "at least `max(2, ceil(N \N{MULTIPLICATION SIGN} 0.15))` of the N spine matches"
        in _PROSE
    )
    # The floor holds for short spines, and the share takes over from 14 on.
    assert [duo_partner_threshold(n) for n in (5, 10, 13, 14, 20, 100)] == [
        2,
        2,
        2,
        3,
        3,
        15,
    ]


def test_two_shared_matches_make_a_duo_in_a_ten_match_spine() -> None:
    flags = classify_duo_matches(
        _spine_meeting("met-twice", 2, MATCH_COUNT), analyzed_puuid="self"
    )

    assert [match_id for match_id, duo in flags.items() if duo] == ["m0", "m1"]


def test_a_chance_repeat_across_a_hundred_match_spine_is_not_a_duo() -> None:
    # LGA-140: a stranger met twice in 100 games is chance, and flagging them
    # removed them from the ally averages; fifteen meetings are a partner.
    twice = classify_duo_matches(
        _spine_meeting("met-twice", 2, 100), analyzed_puuid="self"
    )
    often = classify_duo_matches(
        _spine_meeting("partner", 15, 100), analyzed_puuid="self"
    )

    assert not any(twice.values())
    assert sum(often.values()) == 15


def _clock_at(monkeypatch: pytest.MonkeyPatch, hour: int) -> None:
    """Freeze the request schema's clock at 2026-11-15, `hour`:00 UTC."""

    class _Frozen(datetime):
        @override
        @classmethod
        def now(cls, tz: tzinfo | None = None) -> datetime:
            return datetime(2026, 11, 15, hour, tzinfo=tz)

    monkeypatch.setattr(schemas_module, "datetime", _Frozen)


@pytest.mark.parametrize(
    ("utc_hour", "last_allowed"),
    # UTC+14 is the latest clock on Earth: its day turns at 10:00 UTC.
    [(9, date(2026, 11, 15)), (10, date(2026, 11, 16))],
    ids=["before-the-first-midnight", "after-it"],
)
def test_the_last_selectable_end_date_is_today_at_the_latest_clock_on_earth(
    monkeypatch: pytest.MonkeyPatch, utc_hour: int, last_allowed: date
) -> None:
    # The input's `max` attribute stops the date picker, not the keyboard, and
    # a viewer ahead of UTC must still be able to choose their own current day.
    _clock_at(monkeypatch, utc_hour)

    accepted = MatchmakingAnalysisRequest(puuid="p-1", end_date=last_allowed)
    with pytest.raises(ValidationError, match="cannot be in the future"):
        MatchmakingAnalysisRequest(
            puuid="p-1", end_date=last_allowed + timedelta(days=1)
        )

    assert accepted.end_date == last_allowed
