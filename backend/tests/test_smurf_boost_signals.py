"""Direct evaluator coverage for the `smurf-boost/v1` signals.

The engine suite drives all eight signals end to end; these call the
evaluators straight, pinning guards a healthy run never exercises.
"""

from app.features.smurf_boost_detection.composite import CompositeContext, EligibleMatch
from app.features.smurf_boost_detection.signals import (
    NOTE_INSUFFICIENT_SHAPE_SAMPLE,
    NOTE_SUMMONER_LEVEL_UNKNOWN,
    SignalInputs,
    evaluate_a4,
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
    summoner_level: int | None = 300,
    thresholds: dict[str, float],
) -> SignalInputs:
    return SignalInputs(
        recent=recent,
        baseline=baseline,
        composite_recent=composite_recent,
        composite_baseline=[0.0] * len(baseline),
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
