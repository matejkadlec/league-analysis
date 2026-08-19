"""The computed fields every matchmaking status/history response serialises."""

import pytest
from pydantic import ValidationError

from app.features.matchmaking_analysis.schemas import (
    MatchmakingAnalysisHistoryItem,
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
