"""Direct evaluator coverage for the `smurf-boost/v1` signals.

The engine suite drives all eight signals end to end; these call the
evaluators straight, pinning guards a healthy run never exercises.
"""

from collections.abc import Callable

import pytest

from app.features.smurf_boost_detection.composite import CompositeContext, EligibleMatch
from app.features.smurf_boost_detection.config import PRESET_CONSERVATIVE, PRESETS
from app.features.smurf_boost_detection.signals import (
    NOTE_INSUFFICIENT_SHAPE_SAMPLE,
    NOTE_SUMMONER_LEVEL_UNKNOWN,
    SignalInputs,
    SignalResult,
    evaluate_a1,
    evaluate_a2,
    evaluate_a3,
    evaluate_a4,
    evaluate_b1,
    evaluate_b2,
    evaluate_b3,
    evaluate_b4,
)


def _match(index: int, *, win: bool) -> EligibleMatch:
    return EligibleMatch(
        match_id=f"EUN1_{index}",
        game_start_timestamp=1_785_000_000_000 - index * 3_600_000,
        game_version="16.14.794.9266",
        timestamp_source="riot_game_start",
        team_position="MIDDLE",
        champion_id=1,
        win=win,
        kda=3.0,
        gold_per_minute=400.0,
        kill_participation=0.5,
        team_damage_percentage=0.25,
        vision_score_per_minute=1.0,
        total_minions_killed=180,
        neutral_minions_killed=0,
        time_played=1800,
        game_duration=1800,
    )


def _inputs(
    *,
    recent: list[EligibleMatch],
    baseline: list[EligibleMatch],
    composite_recent: list[float],
    composite_baseline: list[float] | None = None,
    summoner_level: int | None = 300,
    thresholds: dict[str, float],
) -> SignalInputs:
    return SignalInputs(
        recent=recent,
        baseline=baseline,
        composite_recent=composite_recent,
        composite_baseline=(
            [0.0] * len(baseline) if composite_baseline is None else composite_baseline
        ),
        prior_champion_games={},
        summoner_level=summoner_level,
        context=CompositeContext(
            pooled={},
            per_role={},
            baseline_center=0.0,
            baseline_spread=1.0,
            degenerate=False,
        ),
        thresholds=thresholds,
    )


def test_a4_without_a_stored_level_reports_itself_unavailable() -> None:
    """An unavailable signal never triggers, never scores, never counts."""
    inputs = _inputs(
        recent=[_match(0, win=True)],
        baseline=[_match(1, win=True)],
        composite_recent=[2.0],
        summoner_level=None,
        thresholds={"a4_summoner_level_gate": 50, "a4_performance_threshold": 1.0},
    )

    result = evaluate_a4(inputs)

    assert result.available is False
    assert result.triggered is False
    assert result.notes == (NOTE_SUMMONER_LEVEL_UNKNOWN,)
    assert result.weight is None
    assert result.contribution is None


def test_a4_needs_both_a_low_account_and_strong_play() -> None:
    thresholds = {"a4_summoner_level_gate": 50, "a4_performance_threshold": 1.0}
    recent = [_match(i, win=True) for i in range(4)]
    baseline = [_match(10 + i, win=True) for i in range(10)]

    low_and_hot = _inputs(
        recent=recent,
        baseline=baseline,
        composite_recent=[2.0] * 4,
        summoner_level=40,
        thresholds=thresholds,
    )
    seasoned = _inputs(
        recent=recent,
        baseline=baseline,
        composite_recent=[2.0] * 4,
        summoner_level=60,
        thresholds=thresholds,
    )
    low_but_cold = _inputs(
        recent=recent,
        baseline=baseline,
        composite_recent=[0.5] * 4,
        summoner_level=40,
        thresholds=thresholds,
    )

    hot = evaluate_a4(low_and_hot)
    assert hot.available is True
    assert hot.triggered is True
    # Above the level gate the signal stays scored but cannot fire...
    above = evaluate_a4(seasoned)
    assert above.available is True
    assert above.triggered is False
    assert above.magnitude == 0.0
    # ...and so does strong play on a seasoned account's level alone.
    assert evaluate_a4(low_but_cold).triggered is False


def test_b4_needs_two_games_before_calling_a_drop_sustained() -> None:
    inputs = _inputs(
        recent=[_match(0, win=False)],
        baseline=[_match(1, win=True)],
        composite_recent=[0.0],
        thresholds={"b4_high_rate_floor": 0.5, "b4_drop_threshold": 0.2},
    )

    result = evaluate_b4(inputs)

    assert result.available is False
    assert result.notes == (NOTE_INSUFFICIENT_SHAPE_SAMPLE,)


def test_b4_requires_the_whole_window_below_the_baseline_not_just_the_average() -> None:
    """A recovered newer half defeats `sustained` despite a 50% overall drop.

    The window is newest first, so a collapse followed by a recovery carries
    the same average as one that never let up -- only the halves tell them
    apart.
    """
    thresholds = {"b4_high_rate_floor": 0.5, "b4_drop_threshold": 0.2}
    baseline = [_match(i, win=True) for i in range(10)]
    recovering = [_match(10 + i, win=(i < 5)) for i in range(10)]
    collapsed = [_match(30 + i, win=False) for i in range(10)]

    recovered = evaluate_b4(
        _inputs(
            recent=recovering,
            baseline=baseline,
            composite_recent=[0.0] * 10,
            thresholds=thresholds,
        )
    )
    fallen = evaluate_b4(
        _inputs(
            recent=collapsed,
            baseline=baseline,
            composite_recent=[0.0] * 10,
            thresholds=thresholds,
        )
    )

    assert recovered.available is True
    assert recovered.triggered is False
    assert fallen.triggered is True
    assert fallen.sample_size == 10


BASE_THRESHOLDS = {
    key: float(value) for key, value in PRESETS[PRESET_CONSERVATIVE].items()
}

# Every one of these compares `value >= threshold` against a single key. The
# compound signals gate on a second threshold too, so each has its own
# boundary test below rather than a row here.
SignalEvaluator = Callable[[SignalInputs], SignalResult]

BOUNDARY_SIGNALS: tuple[tuple[SignalEvaluator, str], ...] = (
    (evaluate_a1, "a1_step_change_threshold"),
    (evaluate_a2, "a2_win_rate_surge_threshold"),
    (evaluate_a3, "a3_novel_champion_threshold"),
    (evaluate_b2, "b2_consistency_shift_threshold"),
)


def _boundary_inputs(thresholds: dict[str, float]) -> SignalInputs:
    """One measurable window: wins throughout, and spread on both sides."""
    return _inputs(
        recent=[_match(index, win=True) for index in range(10)],
        baseline=[_match(20 + index, win=False) for index in range(10)],
        composite_recent=[1.0, 1.4, 1.8, 2.2, 2.6, 3.0, 3.4, 3.8, 4.2, 4.6],
        composite_baseline=[0.0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 1.8],
        thresholds=thresholds,
    )


@pytest.mark.parametrize(
    ("evaluate", "threshold_key"),
    BOUNDARY_SIGNALS,
    ids=[key for _, key in BOUNDARY_SIGNALS],
)
def test_a_value_sitting_exactly_on_the_threshold_triggers(
    evaluate: SignalEvaluator, threshold_key: str
) -> None:
    """The published threshold is the lowest triggering value.

    Every other fixture clears its threshold comfortably, so `>=` and `>`
    behave identically there and the boundary can move unnoticed.
    """
    measured = evaluate(_boundary_inputs({**BASE_THRESHOLDS, threshold_key: -100.0}))
    assert measured.available, measured.reason
    assert measured.raw_value is not None

    at_threshold = evaluate(
        _boundary_inputs({**BASE_THRESHOLDS, threshold_key: measured.raw_value})
    )

    assert at_threshold.threshold == measured.raw_value
    assert at_threshold.triggered


def test_a4_triggers_on_an_account_sitting_exactly_on_the_level_gate() -> None:
    """Both of A4's conditions include their boundary.

    An account exactly at the gate is the one the gate was chosen for, and the
    threshold is the figure the preset publishes.
    """
    result = evaluate_a4(
        _inputs(
            recent=[_match(index, win=True) for index in range(4)],
            baseline=[_match(20 + index, win=False) for index in range(4)],
            composite_recent=[1.0, 2.0],
            summoner_level=45,
            thresholds={
                **BASE_THRESHOLDS,
                "a4_summoner_level_gate": 45.0,
                "a4_performance_threshold": 1.5,
            },
        )
    )

    assert result.raw_value == 1.5
    assert result.triggered


def test_b1_triggers_with_the_delta_at_its_floor_and_the_drift_at_its_ceiling() -> None:
    """B1 pairs an inclusive floor with an inclusive ceiling.

    Performance drift exactly at the ceiling is still flat enough to count, so
    a strict comparison on either side drops the case the signal describes.
    """
    result = evaluate_b1(
        _inputs(
            recent=[_match(index, win=True) for index in range(10)],
            baseline=[_match(20 + index, win=False) for index in range(10)],
            composite_recent=[0.5] * 10,
            composite_baseline=[0.0] * 10,
            thresholds={
                **BASE_THRESHOLDS,
                "b1_win_rate_delta_threshold": 1.0,
                "b1_composite_flat_ceiling": 0.5,
            },
        )
    )

    assert result.raw_value == 1.0
    assert result.triggered


def _b3_inputs(thresholds: dict[str, float]) -> SignalInputs:
    """A recent window split exactly on both cuts, half high and half low."""
    return _inputs(
        recent=[_match(index, win=index % 2 == 0) for index in range(12)],
        baseline=[_match(20 + index, win=False) for index in range(12)],
        composite_recent=[1.0] * 6 + [-0.5] * 6,
        composite_baseline=[float(index) for index in range(12)],
        thresholds=thresholds,
    )


def test_b3_counts_games_sitting_exactly_on_the_high_and_low_cuts() -> None:
    """The tail fractions include their boundary, and the cuts include theirs.

    Every game here sits exactly on a cut, so a strict comparison anywhere in
    the pair counts no tails at all and the signal can never fire.
    """
    result = evaluate_b3(
        _b3_inputs(
            {**BASE_THRESHOLDS, "b3_tail_fraction": 0.5, "b3_bimodality_threshold": 0.0}
        )
    )

    assert result.available, result.reason
    assert result.triggered


def test_b3_does_not_fire_on_a_coefficient_only_equal_to_its_threshold() -> None:
    """B3's coefficient comparison is strict, unlike every other threshold.

    Pinned because the asymmetry looks like an oversight: the tails include
    their boundary and this one does not.
    """
    measured = evaluate_b3(
        _b3_inputs(
            {**BASE_THRESHOLDS, "b3_tail_fraction": 0.5, "b3_bimodality_threshold": 0.0}
        )
    )
    assert measured.raw_value is not None

    at_threshold = evaluate_b3(
        _b3_inputs(
            {
                **BASE_THRESHOLDS,
                "b3_tail_fraction": 0.5,
                "b3_bimodality_threshold": measured.raw_value,
            }
        )
    )

    assert not at_threshold.triggered


def test_b4_triggers_with_the_baseline_at_its_floor_and_the_drop_at_its_threshold() -> (
    None
):
    """B4's floor and drop are both inclusive, and the halves must both fall.

    The recent window is split so each half sits below the baseline, which is
    what separates a sustained decline from one bad stretch.
    """
    recent = [_match(index, win=index < 3) for index in range(5)]
    recent += [_match(5 + index, win=index < 2) for index in range(5)]

    result = evaluate_b4(
        _inputs(
            recent=recent,
            baseline=[_match(20 + index, win=True) for index in range(10)],
            composite_recent=[1.0] * 10,
            thresholds={
                **BASE_THRESHOLDS,
                "b4_high_rate_floor": 1.0,
                "b4_drop_threshold": 0.5,
            },
        )
    )

    assert result.raw_value == 0.5
    assert result.triggered
