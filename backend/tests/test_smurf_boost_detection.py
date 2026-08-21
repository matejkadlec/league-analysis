"""Regression coverage for the `smurf-boost/v1` detection model.

The fixtures mirror the model's own validation plan. The
engine is pure, so every case is built from constructed matches with no database
and no mocking.

Fixture construction relies on one property: when every composite metric is
`base * (1 + 0.5 * level)`, each z-score reduces to `level / sd(levels)`, so the
standardized composite of a match is exactly
`(level - mean(baseline levels)) / sd(baseline levels)`. Levels are therefore a
direct handle on `C`.
"""

from __future__ import annotations

import math
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.riot_api.constants import RANKED_SOLO_QUEUE_ID
from app.features.settings.schemas import (
    CardId,
    serialize_card_preference_settings,
    validate_card_preference_update,
)
from app.features.smurf_boost_detection.composite import EligibleMatch, build_context
from app.features.smurf_boost_detection.config import (
    BAND_NONE,
    BAND_NOT_ENOUGH_DATA,
    BAND_NOTABLE,
    BAND_STRONG,
    BAND_WEAK,
    DEFAULT_PRESET,
    MIN_MAGNITUDE,
    MINIMUM_GAME_DURATION_SECONDS,
    MODEL_VERSION,
    PRESETS,
    RECOGNIZED_POSITIONS,
    SIGNAL_SATURATIONS,
    SIGNAL_WEIGHTS,
)
from app.features.smurf_boost_detection.engine import (
    FAMILY_A,
    FAMILY_B,
    AnalysisRequest,
    analyze,
)
from app.features.smurf_boost_detection.models import SmurfBoostAnalysis
from app.features.smurf_boost_detection.router import ERROR_STATUS_CODES
from app.features.smurf_boost_detection.schemas import DISCLAIMER
from app.features.smurf_boost_detection.service import (
    MAX_WINDOW_MATCHES,
    SmurfBoostDetectionError,
    SmurfBoostDetectionService,
    _serialize,
    resolve_thresholds,
)
from app.features.smurf_boost_detection.statistics import (
    bimodality_coefficient,
    clamp,
    hedges_g,
    population_variance,
    sample_variance,
    wilson_lower_bound,
)

CONSERVATIVE = {key: float(value) for key, value in PRESETS["conservative"].items()}

BASE_METRICS: dict[str, float] = {
    "kda": 3.0,
    "gold_per_minute": 400.0,
    "kill_participation": 0.5,
    "team_damage_percentage": 0.25,
    "vision_score_per_minute": 1.0,
}
BASE_MINIONS = 180
TIME_PLAYED = 1800


def _match(
    index: int,
    *,
    level: float = 0.0,
    win: bool = False,
    champion_id: int = 1,
    role: str = "MIDDLE",
    patch: str = "16.14.794.9266",
    timestamp_source: str = "riot_game_start",
) -> EligibleMatch:
    """One eligible match whose composite metrics all scale with `level`."""
    scale = 1 + 0.5 * level
    return EligibleMatch(
        match_id=f"EUN1_{100000 + index}",
        game_start_timestamp=1_785_000_000_000 - index * 3_600_000,
        game_version=patch,
        timestamp_source=timestamp_source,
        team_position=role,
        champion_id=champion_id,
        win=win,
        kda=BASE_METRICS["kda"] * scale,
        gold_per_minute=BASE_METRICS["gold_per_minute"] * scale,
        kill_participation=BASE_METRICS["kill_participation"] * scale,
        team_damage_percentage=BASE_METRICS["team_damage_percentage"] * scale,
        vision_score_per_minute=BASE_METRICS["vision_score_per_minute"] * scale,
        # Minions are counted, so a scaled fixture still has to land on a whole
        # number the way a stored row would.
        total_minions_killed=round(BASE_MINIONS * scale),
        neutral_minions_killed=0,
        time_played=TIME_PLAYED,
        game_duration=TIME_PLAYED,
    )


BASELINE_LEVELS = (-1.0, -0.5, 0.0, 0.5, 1.0)


def _spread_wins(count: int, wins: int) -> list[bool]:
    """Distribute wins evenly across a window rather than front-loading them.

    Front-loaded wins would put every win in one half, which silently defeats
    the sustained-reversal guard the fixtures exist to exercise.
    """
    return [((i + 1) * wins) // count - (i * wins) // count == 1 for i in range(count)]


def _window(
    count: int,
    *,
    levels: list[float] | None = None,
    wins: int = 0,
    win_pattern: list[bool] | None = None,
    start_index: int = 0,
    champion_ids: list[int] | None = None,
    role: str = "MIDDLE",
    patch: str = "16.14.794.9266",
    timestamp_source: str = "riot_game_start",
) -> list[EligibleMatch]:
    """A run of matches with explicit levels, wins and champions."""
    chosen = levels or [BASELINE_LEVELS[i % len(BASELINE_LEVELS)] for i in range(count)]
    champions = champion_ids or [1 + (i % 3) for i in range(count)]
    outcomes = win_pattern if win_pattern is not None else _spread_wins(count, wins)
    return [
        _match(
            start_index + i,
            level=chosen[i],
            win=outcomes[i],
            champion_id=champions[i],
            role=role,
            patch=patch,
            timestamp_source=timestamp_source,
        )
        for i in range(count)
    ]


def _request(
    recent: list[EligibleMatch],
    baseline: list[EligibleMatch],
    *,
    summoner_level: int | None = 300,
    rank_span_days: float | None = None,
    thresholds: dict[str, float] | None = None,
    prior_champion_games: dict[int, int] | None = None,
) -> AnalysisRequest:
    """Bundle two prepared windows into an analysis request."""
    counts: dict[int, int] = prior_champion_games or {}
    if not counts:
        for match in baseline:
            counts[match.champion_id] = counts.get(match.champion_id, 0) + 1
    resolved = dict(thresholds) if thresholds else dict(CONSERVATIVE)
    if thresholds is None:
        resolved["recent_window_size"] = float(len(recent))
        resolved["baseline_window_size"] = float(len(baseline))
    return AnalysisRequest(
        eligible=recent + baseline,
        summoner_level=summoner_level,
        rank_span_days=rank_span_days,
        thresholds=resolved,
        prior_champion_games=counts,
    )


def _signal(result: Any, family: str, signal_id: str) -> Any:
    """Look one signal up inside a family result."""
    family_result = next(item for item in result.families if item.family == family)
    return next(item for item in family_result.signals if item.signal_id == signal_id)


def _family(result: Any, family: str) -> Any:
    """Look one family up in a detection result."""
    return next(item for item in result.families if item.family == family)


# ---------------------------------------------------------------------------
# Exact statistics, pinned so a library swap cannot change a threshold's meaning
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("successes", "trials", "expected"),
    [(9, 10, 0.5958), (23, 30, 0.5907), (24, 30, 0.6269), (27, 30, 0.7438)],
)
def test_wilson_lower_bound_matches_the_specified_estimator(
    successes: int, trials: int, expected: float
) -> None:
    """The small-sample guard is the exact interval the thresholds assume."""
    assert wilson_lower_bound(successes, trials) == pytest.approx(expected, abs=5e-5)


def test_bimodality_coefficient_uses_population_second_moment() -> None:
    """A sample-standard-deviation variant would give a different threshold."""
    split = [1.5] * 10 + [-1.0] * 10
    assert bimodality_coefficient(split) == pytest.approx(0.7669, abs=5e-4)

    with_middle = [1.5] * 7 + [-1.0] * 7 + [0.0] * 6
    assert bimodality_coefficient(with_middle) == pytest.approx(0.5660, abs=5e-4)


def test_undefined_statistics_report_none_instead_of_raising() -> None:
    """A degenerate window must be reported, never divided by."""
    assert bimodality_coefficient([1.0] * 20) is None
    assert bimodality_coefficient([1.0, 2.0]) is None
    assert hedges_g([1.0] * 10, [1.0] * 10) is None


def test_the_two_variance_denominators_stay_apart() -> None:
    """`n` and `n - 1` are both used here, deliberately and in different places.

    The module aliases both denominators to `statistics`, one line apart, so
    swapping which name points at which is an edit that changes no shape and
    no type:
    the composite keeps standardizing, `hedges_g` keeps returning a float, and
    every threshold in the model quietly means something else. On eight games
    the two differ by 14 percent, which is the width of a band.
    """
    values = [2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0]

    assert population_variance(values) == pytest.approx(4.0)
    assert sample_variance(values) == pytest.approx(32.0 / 7.0)


def test_hedges_g_keeps_its_small_sample_correction() -> None:
    """The correction is the whole difference between Hedges' g and Cohen's d.

    Drop it and the function still returns a plausible effect size, larger
    than the real one -- by 13 percent on the eight-game windows this model
    actually sees, which is enough to carry a player across a calibrated
    threshold and into a stronger accusation than the evidence supports.
    """
    recent = [10.0, 12.0, 14.0, 16.0]
    baseline = [2.0, 4.0, 6.0, 8.0]

    corrected = hedges_g(recent, baseline)
    assert corrected is not None
    assert corrected == pytest.approx(2.6942, abs=5e-4)

    # The uncorrected ratio, which is what the mutation returns.
    uncorrected = 8.0 / math.sqrt(40.0 / 6.0)
    assert corrected < uncorrected


def test_windows_too_small_to_have_spread_report_zero_or_none() -> None:
    """One observation carries no dispersion, and the model must not invent it.

    A player with a single recent game reaches these helpers the same way as
    one with fifty. Dividing by `n - 1` would raise on the first and there is
    no interval to compute on a player with no games at all -- each guard is a
    real input this model receives, not a defensive flourish.
    """
    assert sample_variance([7.0]) == 0.0
    assert sample_variance([]) == 0.0
    assert wilson_lower_bound(0, 0) == 0.0
    assert hedges_g([1.0], [2.0]) is None


# ---------------------------------------------------------------------------
# Composite construction
# ---------------------------------------------------------------------------


def test_composite_is_standardized_against_the_baseline_window() -> None:
    """`sd(C_B)` is exactly 1, which is what the thresholds are expressed in."""
    from app.features.smurf_boost_detection.composite import standardized_series

    baseline = _window(60)
    recent = _window(20, start_index=60)
    context = build_context(recent, baseline)
    series = standardized_series(baseline, context)

    assert sum(series) / len(series) == pytest.approx(0.0, abs=1e-9)
    variance = sum(value**2 for value in series) / len(series)
    assert variance == pytest.approx(1.0, abs=1e-9)


def test_pooled_role_baseline_is_reported_when_a_role_is_thin() -> None:
    """A role with too little baseline history must be flagged, not hidden."""
    baseline = _window(60, role="MIDDLE")
    recent = _window(20, start_index=60, role="JUNGLE")
    context = build_context(recent, baseline)

    assert "role_baseline_pooled" in context.notes


def test_a_role_seen_only_in_the_recent_window_still_has_a_baseline() -> None:
    """A never-before-played role must not raise a lookup error."""
    baseline = _window(60, role="MIDDLE")
    recent = _window(20, start_index=60, role="UTILITY")
    result = analyze(_request(recent, baseline))

    assert _family(result, FAMILY_A).band != BAND_NOT_ENOUGH_DATA


# ---------------------------------------------------------------------------
# Sample floor and the first-class insufficient-data outcome
# ---------------------------------------------------------------------------


def test_below_floor_reports_not_enough_data_for_both_families() -> None:
    """Insufficient history is an outcome, not a failure."""
    result = analyze(_request(_window(9), _window(60, start_index=9)))

    for family in result.families:
        assert family.band == BAND_NOT_ENOUGH_DATA
        assert family.signals == ()
    assert result.recent_games == 9


def test_thin_baseline_reports_not_enough_data() -> None:
    """A recent window alone cannot produce a band."""
    result = analyze(_request(_window(20), _window(14, start_index=20)))

    assert _family(result, FAMILY_A).band == BAND_NOT_ENOUGH_DATA


def test_flat_baseline_triggers_nothing_under_every_preset() -> None:
    """Unremarkable play must stay at No unusual pattern for all presets."""
    for name, preset in PRESETS.items():
        thresholds = {key: float(value) for key, value in preset.items()}
        recent_size = int(thresholds["recent_window_size"])
        baseline_size = int(thresholds["baseline_window_size"])
        recent = _window(recent_size, wins=recent_size // 2)
        baseline = _window(
            baseline_size, wins=baseline_size // 2, start_index=recent_size
        )
        result = analyze(_request(recent, baseline, thresholds=thresholds))

        for family in result.families:
            assert family.band == BAND_NONE, f"{name} moved {family.family}"
            assert not any(signal.triggered for signal in family.signals)


# ---------------------------------------------------------------------------
# Family A
# ---------------------------------------------------------------------------


def test_step_change_triggers_a1() -> None:
    """A large, sustained rise against the player's own baseline is A1."""
    baseline = _window(60, wins=30)
    recent = _window(20, levels=[3.0] * 20, wins=10, start_index=60)
    result = analyze(_request(recent, baseline))

    a1 = _signal(result, FAMILY_A, "A1")
    assert a1.available and a1.triggered
    assert a1.raw_value is not None and a1.raw_value >= 1.20
    assert _family(result, FAMILY_A).band != BAND_NONE


def test_small_win_rate_surge_cannot_trigger_a2() -> None:
    """The Wilson guard is what stops a ten-game hot streak from firing."""
    baseline = _window(60, wins=30)
    recent = _window(10, wins=9, start_index=60)

    for preset in PRESETS.values():
        thresholds = {key: float(value) for key, value in preset.items()}
        thresholds["recent_window_size"] = 10.0
        thresholds["baseline_window_size"] = 60.0
        result = analyze(_request(recent, baseline, thresholds=thresholds))
        a2 = _signal(result, FAMILY_A, "A2")
        assert a2.raw_value == pytest.approx(0.0958, abs=5e-4)
        assert not a2.triggered


def test_large_win_rate_surge_separates_the_presets() -> None:
    """A 24/30 surge clears Sensitive only; Balanced and Conservative hold."""
    baseline = _window(60, wins=30)
    recent = _window(30, wins=24, start_index=60)
    thresholds = dict(CONSERVATIVE)
    thresholds["recent_window_size"] = 30.0

    conservative = analyze(_request(recent, baseline, thresholds=thresholds))
    assert _signal(conservative, FAMILY_A, "A2").raw_value == pytest.approx(
        0.1269, abs=5e-4
    )
    assert not _signal(conservative, FAMILY_A, "A2").triggered

    balanced = {key: float(value) for key, value in PRESETS["balanced"].items()}
    balanced["recent_window_size"] = 30.0
    balanced["baseline_window_size"] = 60.0
    assert not _signal(
        analyze(_request(recent, baseline, thresholds=balanced)), FAMILY_A, "A2"
    ).triggered

    sensitive = {key: float(value) for key, value in PRESETS["sensitive"].items()}
    sensitive["recent_window_size"] = 30.0
    sensitive["baseline_window_size"] = 60.0
    assert _signal(
        analyze(_request(recent, baseline, thresholds=sensitive)), FAMILY_A, "A2"
    ).triggered


def test_decisive_win_rate_surge_triggers_a2_under_conservative() -> None:
    """A 27/30 surge is large enough for the strictest preset."""
    baseline = _window(60, wins=30)
    recent = _window(30, wins=27, start_index=60)
    thresholds = dict(CONSERVATIVE)
    thresholds["recent_window_size"] = 30.0

    a2 = _signal(
        analyze(_request(recent, baseline, thresholds=thresholds)), FAMILY_A, "A2"
    )
    assert a2.raw_value == pytest.approx(0.2438, abs=5e-4)
    assert a2.triggered


def test_novel_champion_overperformance_triggers_a3() -> None:
    """Strong results on champions with no stored history are A3."""
    baseline = _window(60, wins=30, champion_ids=[1] * 60)
    recent = _window(
        20,
        levels=[3.0] * 20,
        wins=10,
        start_index=60,
        champion_ids=[900 + i for i in range(20)],
    )
    result = analyze(_request(recent, baseline, prior_champion_games={1: 60}))

    a3 = _signal(result, FAMILY_A, "A3")
    assert a3.available and a3.triggered
    assert "novel_is_storage_scoped" in a3.notes


def test_too_few_novel_games_makes_a3_unavailable() -> None:
    """An unmet sample gate is reported, never silently treated as passing."""
    baseline = _window(60, wins=30, champion_ids=[1] * 60)
    recent = _window(
        20,
        levels=[3.0] * 20,
        wins=10,
        start_index=60,
        champion_ids=[900, 901, 902] + [1] * 17,
    )
    result = analyze(_request(recent, baseline, prior_champion_games={1: 60}))

    a3 = _signal(result, FAMILY_A, "A3")
    assert not a3.available and not a3.triggered
    assert "insufficient_novel_sample" in a3.notes


def test_low_account_level_with_strong_play_triggers_a4() -> None:
    """A4 fires only behind its level gate, and always names its weakness."""
    baseline = _window(60, wins=30)
    recent = _window(20, levels=[3.0] * 20, wins=10, start_index=60)
    result = analyze(_request(recent, baseline, summoner_level=38))

    a4 = _signal(result, FAMILY_A, "A4")
    assert a4.triggered
    assert "weak_account_age_proxy" in a4.notes


def test_high_account_level_does_not_trigger_a4() -> None:
    """The gate is what makes A4 about account level at all."""
    baseline = _window(60, wins=30)
    recent = _window(20, levels=[3.0] * 20, wins=10, start_index=60)
    result = analyze(_request(recent, baseline, summoner_level=901))

    assert not _signal(result, FAMILY_A, "A4").triggered


def test_unknown_account_level_makes_a4_unavailable() -> None:
    """A null level must never be compared as if it passed the gate."""
    baseline = _window(60, wins=30)
    recent = _window(20, levels=[3.0] * 20, wins=10, start_index=60)
    result = analyze(_request(recent, baseline, summoner_level=None))

    a4 = _signal(result, FAMILY_A, "A4")
    assert not a4.available and not a4.triggered
    assert "summoner_level_unknown" in a4.notes


# ---------------------------------------------------------------------------
# Family B
# ---------------------------------------------------------------------------


def test_win_rate_surge_without_performance_triggers_b1() -> None:
    """A win-rate jump that per-game performance does not explain is B1."""
    baseline = _window(60, wins=24)
    recent = _window(20, wins=17, start_index=60)
    result = analyze(_request(recent, baseline))

    b1 = _signal(result, FAMILY_B, "B1")
    assert b1.triggered
    assert b1.contribution is not None and b1.contribution > 0


def test_a_triggered_signal_always_contributes_something() -> None:
    """The magnitude floor stops a shown signal from scoring exactly zero."""
    baseline = _window(60, wins=24)
    recent = _window(20, wins=18, start_index=60)
    thresholds = dict(CONSERVATIVE)
    thresholds["b1_win_rate_delta_threshold"] = 0.50

    result = analyze(_request(recent, baseline, thresholds=thresholds))
    b1 = _signal(result, FAMILY_B, "B1")
    assert b1.triggered
    assert b1.magnitude == pytest.approx(MIN_MAGNITUDE)
    assert b1.contribution == pytest.approx(SIGNAL_WEIGHTS["B1"] * MIN_MAGNITUDE)


def test_consistency_collapse_triggers_b2() -> None:
    """A recent window far narrower than the baseline is a spread change."""
    baseline = _window(60, wins=30)
    recent = _window(20, levels=[0.0] * 19 + [0.05], wins=10, start_index=60)
    result = analyze(_request(recent, baseline))

    b2 = _signal(result, FAMILY_B, "B2")
    assert b2.available and b2.triggered


def test_consistency_expansion_triggers_b2() -> None:
    """A recent window far wider than the baseline is also a spread change."""
    baseline = _window(60, wins=30)
    recent = _window(
        20, levels=[3.0 if i % 2 else -3.0 for i in range(20)], wins=10, start_index=60
    )
    result = analyze(_request(recent, baseline))

    assert _signal(result, FAMILY_B, "B2").triggered


def test_champion_pool_churn_alone_triggers_nothing() -> None:
    """The rejected pool-divergence measure must not have been reinstated."""
    baseline = _window(60, wins=30, champion_ids=[1, 2, 3] * 20)
    recent = _window(
        20, wins=10, start_index=60, champion_ids=[500 + i for i in range(20)]
    )
    result = analyze(
        _request(recent, baseline, prior_champion_games={1: 20, 2: 20, 3: 20})
    )

    assert _family(result, FAMILY_B).band == BAND_NONE


def test_bimodal_recent_window_triggers_b3() -> None:
    """Strong and weak games both present in the same window is B3."""
    baseline = _window(60, wins=30)
    recent = _window(
        20,
        levels=[2.0] * 10 + [-2.0] * 10,
        wins=10,
        start_index=60,
    )
    result = analyze(_request(recent, baseline))

    assert _signal(result, FAMILY_B, "B3").triggered


def test_short_recent_window_makes_b3_unavailable() -> None:
    """Below the stability floor the shape estimate is reported, not guessed."""
    baseline = _window(60, wins=30)
    recent = _window(11, wins=5, start_index=60)
    thresholds = dict(CONSERVATIVE)
    thresholds["recent_window_size"] = 11.0

    b3 = _signal(
        analyze(_request(recent, baseline, thresholds=thresholds)), FAMILY_B, "B3"
    )
    assert not b3.available
    assert "insufficient_shape_sample" in b3.notes


def test_sustained_reversal_triggers_b4() -> None:
    """A drop that persists across both halves of the window is B4."""
    baseline = _window(60, wins=42)
    recent = _window(20, wins=8, start_index=60)
    result = analyze(_request(recent, baseline))

    assert _signal(result, FAMILY_B, "B4").triggered


def test_unsustained_reversal_does_not_trigger_b4() -> None:
    """The halves guard, not the aggregate drop, is what stops this case."""
    baseline = _window(60, wins=42)
    # Newest first: the newer half wins 7 of 10, the older half 2 of 10.
    newer = [True] * 7 + [False] * 3
    older = [True] * 2 + [False] * 8
    recent = _window(20, win_pattern=newer + older, start_index=60)
    result = analyze(_request(recent, baseline))

    b4 = _signal(result, FAMILY_B, "B4")
    assert b4.raw_value is not None and b4.raw_value >= 0.20
    assert not b4.triggered


# ---------------------------------------------------------------------------
# Degenerate baseline
# ---------------------------------------------------------------------------


def test_degenerate_baseline_makes_composite_signals_unavailable() -> None:
    """With no baseline spread the composite is undefined, never divided by."""
    baseline = _window(60, levels=[0.0] * 60, wins=30)
    recent = _window(20, levels=[0.0] * 20, wins=10, start_index=60)
    result = analyze(_request(recent, baseline))

    for signal_id in ("A1", "A3", "A4"):
        signal = _signal(result, FAMILY_A, signal_id)
        assert not signal.available
        assert "degenerate_baseline" in signal.notes
    for signal_id in ("B1", "B2", "B3"):
        signal = _signal(result, FAMILY_B, signal_id)
        assert not signal.available
        assert "degenerate_baseline" in signal.notes

    assert _signal(result, FAMILY_A, "A2").available
    assert _signal(result, FAMILY_B, "B4").available


# ---------------------------------------------------------------------------
# Bands and the distinct-evidence guard
# ---------------------------------------------------------------------------


def test_one_evidence_group_is_capped_at_weak_indicators() -> None:
    """A1 and A4 read the same number, so together they are one witness."""
    baseline = _window(60, wins=30)
    recent = _window(20, levels=[3.0] * 20, wins=10, start_index=60)
    result = analyze(_request(recent, baseline, summoner_level=38))

    family = _family(result, FAMILY_A)
    triggered = {signal.signal_id for signal in family.signals if signal.triggered}
    assert triggered == {"A1", "A4"}
    assert family.distinct_evidence == 1
    assert family.score >= 0.40
    assert family.band == BAND_WEAK


def test_three_evidence_groups_reach_strong_indicators() -> None:
    """Strong requires three genuinely different areas to move."""
    baseline = _window(60, wins=18, champion_ids=[1] * 60)
    recent = _window(
        20,
        levels=[3.0] * 20,
        wins=20,
        start_index=60,
        champion_ids=[900 + i for i in range(20)],
    )
    result = analyze(
        _request(recent, baseline, summoner_level=901, prior_champion_games={1: 60})
    )

    family = _family(result, FAMILY_A)
    triggered = {signal.signal_id for signal in family.signals if signal.triggered}
    # A4 is deliberately gated off by the account level, so the three evidence
    # groups have to come from three genuinely different statistics rather than
    # from a second reading of the same one.
    assert triggered == {"A1", "A2", "A3"}
    assert family.distinct_evidence == 3
    assert family.score == pytest.approx(0.80, abs=1e-6)
    assert family.band == BAND_STRONG


def test_notable_requires_two_evidence_groups() -> None:
    """The middle band is exactly two different areas moving together."""
    baseline = _window(60, wins=18)
    recent = _window(20, levels=[3.0] * 20, wins=20, start_index=60)
    result = analyze(_request(recent, baseline, summoner_level=901))

    family = _family(result, FAMILY_A)
    assert family.distinct_evidence == 2
    assert family.band == BAND_NOTABLE


# ---------------------------------------------------------------------------
# Confidence
# ---------------------------------------------------------------------------


def test_disjoint_patches_reduce_confidence() -> None:
    """A patch boundary between the windows is a data-quality penalty."""
    baseline = _window(60, wins=30, patch="16.10.100.1")
    recent = _window(20, wins=10, start_index=60, patch="16.14.794.9266")
    result = analyze(_request(recent, baseline))

    assert "patch_disjoint_windows" in result.notes
    assert result.confidence == pytest.approx(0.85, abs=1e-6)


def test_legacy_timestamps_reduce_confidence() -> None:
    """Loading-screen timestamps are recorded as a quality limit."""
    baseline = _window(60, wins=30, timestamp_source="legacy_game_creation")
    recent = _window(20, wins=10, start_index=60)
    result = analyze(_request(recent, baseline))

    assert "legacy_game_start_timestamps" in result.notes
    assert result.confidence == pytest.approx(0.90, abs=1e-6)


def test_missing_rank_history_is_neutral() -> None:
    """Absent rank data must not be read as reduced confidence."""
    result = analyze(
        _request(_window(20, wins=10), _window(60, wins=30, start_index=20))
    )

    assert "rank_corroboration_unavailable" in result.notes
    assert result.confidence == pytest.approx(1.0, abs=1e-6)


def test_short_rank_span_barely_moves_confidence() -> None:
    """A three-day rank history is low corroboration, not a free full mark.

    The baseline is deliberately half-filled so the bonus is measured before
    the clamp. Against a full window the product saturates at 1.0 and any
    bonus, however wrong, would look correct.
    """
    recent = _window(20, wins=10)
    baseline = _window(30, wins=15, start_index=20)
    result = analyze(
        _request(recent, baseline, thresholds=dict(CONSERVATIVE), rank_span_days=3.0)
    )

    # 0.5 coverage * (1 + 0.05 * 3/30)
    assert result.confidence == pytest.approx(0.5025, abs=1e-6)
    assert result.confidence_band == "medium"


def test_partial_window_coverage_lowers_confidence() -> None:
    """A half-filled baseline is reported as weaker evidence."""
    recent = _window(20, wins=10)
    baseline = _window(30, wins=15, start_index=20)
    result = analyze(_request(recent, baseline, thresholds=dict(CONSERVATIVE)))

    assert result.baseline_games == 30
    assert result.confidence == pytest.approx(0.5, abs=1e-6)
    assert result.confidence_band == "medium"


# ---------------------------------------------------------------------------
# Model invariants
# ---------------------------------------------------------------------------


def test_every_bounded_range_stays_below_its_saturation() -> None:
    """A range top at or above saturation would divide by zero or invert."""
    from app.features.settings.schemas import SmurfBoostDetectionMutableSettingsWriteV1

    field_to_signal = {
        "a1_step_change_threshold": "A1",
        "a2_win_rate_surge_threshold": "A2",
        "a3_novel_champion_threshold": "A3",
        "a4_performance_threshold": "A4",
        "b1_win_rate_delta_threshold": "B1",
        "b2_consistency_shift_threshold": "B2",
        "b3_bimodality_threshold": "B3",
        "b4_drop_threshold": "B4",
    }
    fields = SmurfBoostDetectionMutableSettingsWriteV1.model_fields
    for field_name, signal_id in field_to_signal.items():
        upper = next(
            item.le for item in fields[field_name].metadata if hasattr(item, "le")
        )
        assert upper < SIGNAL_SATURATIONS[signal_id], field_name


def test_family_weights_sum_to_one() -> None:
    """Both family scores are directly comparable in the range zero to one."""
    assert sum(
        SIGNAL_WEIGHTS[key] for key in ("A1", "A2", "A3", "A4")
    ) == pytest.approx(1.0)
    assert sum(
        SIGNAL_WEIGHTS[key] for key in ("B1", "B2", "B3", "B4")
    ) == pytest.approx(1.0)


def test_conservative_is_the_shipped_default() -> None:
    """The documented default preset is the one a new viewer receives."""
    assert DEFAULT_PRESET == "conservative"
    assert resolve_thresholds(None) == CONSERVATIVE


def test_stored_settings_override_only_known_numeric_keys() -> None:
    """A malformed stored value must fall back to the default, not propagate."""
    resolved = resolve_thresholds(
        {"a1_step_change_threshold": 0.8, "unknown": 5, "b4_drop_threshold": "bad"}
    )

    assert resolved["a1_step_change_threshold"] == pytest.approx(0.8)
    assert resolved["b4_drop_threshold"] == CONSERVATIVE["b4_drop_threshold"]
    assert "unknown" not in resolved


def test_the_disclaimer_never_reads_as_an_accusation() -> None:
    """The fixed disclaimer is part of the contract, not decoration."""
    assert "not evidence of smurfing" in DISCLAIMER
    assert "Do not use it to accuse anyone." in DISCLAIMER


# ---------------------------------------------------------------------------
# Catalog registration
# ---------------------------------------------------------------------------


def test_the_detection_card_is_in_the_approved_catalog() -> None:
    """The engine reads thresholds through the existing viewer-scoped catalog."""
    assert CardId.SMURF_BOOST_DETECTION.value == "profile.smurf-boost-detection"


#: Every threshold the detection card accepts, spelled the one way the write
#: contract allows. Tests that care about a single threshold override it here
#: rather than restating the other fourteen.
_VALID_DETECTION_PAYLOAD: dict[str, Any] = {
    "recentWindowSize": 20,
    "baselineWindowSize": 60,
    "a1StepChangeThreshold": 1.2,
    "a2WinRateSurgeThreshold": 0.2,
    "a3NovelChampionThreshold": 1.2,
    "a3MinimumNovelGames": 8,
    "a4SummonerLevelGate": 45,
    "a4PerformanceThreshold": 1.2,
    "b1WinRateDeltaThreshold": 0.3,
    "b1CompositeFlatCeiling": 0.05,
    "b2ConsistencyShiftThreshold": 1.15,
    "b3BimodalityThreshold": 0.65,
    "b3TailFraction": 0.3,
    "b4HighRateFloor": 0.62,
    "b4DropThreshold": 0.2,
}


def test_detection_settings_accept_only_canonical_camel_case_names() -> None:
    """The write contract stays strict for the new card too."""
    stored = validate_card_preference_update(
        CardId.SMURF_BOOST_DETECTION, _VALID_DETECTION_PAYLOAD
    )
    assert stored["recent_window_size"] == 20

    with pytest.raises(ValueError):
        validate_card_preference_update(
            CardId.SMURF_BOOST_DETECTION,
            {**_VALID_DETECTION_PAYLOAD, "recent_window_size": 20},
        )


def test_detection_settings_reject_an_unsatisfiable_novel_gate() -> None:
    """Cross-field validation stops a permanently unavailable signal."""
    # Asking for 15 novel champions inside a 10-game window can never be met.
    unsatisfiable = {
        **_VALID_DETECTION_PAYLOAD,
        "recentWindowSize": 10,
        "a3MinimumNovelGames": 15,
    }
    with pytest.raises(ValueError):
        validate_card_preference_update(CardId.SMURF_BOOST_DETECTION, unsatisfiable)


# ---------------------------------------------------------------------------
# Service orchestration
#
# The engine above is pure, but the defects that actually reach a viewer live
# in how the service loads history, claims a run and shapes its output. These
# cases drive the service directly with a stub session, which is how the
# matchmaking analysis lifecycle is covered in this suite.
# ---------------------------------------------------------------------------


def _completed_run(**overrides: Any) -> SmurfBoostAnalysis:
    """A stored run in whatever state a case needs."""
    fields: dict[str, Any] = {
        "puuid": "p",
        "created_at": datetime(2026, 8, 14, tzinfo=UTC),
        "status": "completed",
        "model_version": MODEL_VERSION,
        "thresholds": dict(CONSERVATIVE),
        "latest_match_id": "EUN1_2",
    }
    fields.update(overrides)
    return SmurfBoostAnalysis(**fields)


def _service(db: MagicMock) -> SmurfBoostDetectionService:
    return SmurfBoostDetectionService(cast(AsyncSession, db))


def _await_args(mock: AsyncMock) -> tuple[Any, ...]:
    """Positional arguments of the recorded await, which must have happened."""
    assert mock.await_args is not None
    return mock.await_args.args


async def test_a_run_over_no_history_becomes_stale_once_a_game_arrives() -> None:
    """A stored identifier of `None` must take part in the comparison."""
    service = _service(MagicMock())
    run = _completed_run(latest_match_id=None)
    service._newest_eligible_match_id = AsyncMock(return_value="EUN1_1")

    assert await service._is_stale(run) is True


async def test_an_unchanged_newest_game_is_not_stale() -> None:
    """The same newest identifier means nothing has been ingested since."""
    service = _service(MagicMock())
    service._newest_eligible_match_id = AsyncMock(return_value="EUN1_2")

    assert await service._is_stale(_completed_run()) is False


async def test_an_unfinished_run_is_never_reported_stale() -> None:
    """Staleness describes a completed answer, not a run still in flight."""
    service = _service(MagicMock())
    service._newest_eligible_match_id = AsyncMock(return_value="EUN1_9")

    assert await service._is_stale(_completed_run(status="in_progress")) is False


def test_a_run_with_other_thresholds_is_not_the_same_configuration() -> None:
    """Attaching across threshold sets would return another viewer's answer."""
    other = dict(CONSERVATIVE)
    other["a1_step_change_threshold"] = 0.80

    assert SmurfBoostDetectionService._matches_configuration(
        _completed_run(), dict(CONSERVATIVE)
    )
    assert not SmurfBoostDetectionService._matches_configuration(
        _completed_run(), other
    )
    assert not SmurfBoostDetectionService._matches_configuration(
        _completed_run(model_version="smurf-boost/v0"), dict(CONSERVATIVE)
    )
    assert not SmurfBoostDetectionService._matches_configuration(
        _completed_run(thresholds={"recent_window_size": 20.0}), dict(CONSERVATIVE)
    )


async def test_a_differently_configured_active_run_is_a_conflict() -> None:
    """A caller must never silently inherit another viewer's settings."""
    service = _service(MagicMock(execute=AsyncMock(), commit=AsyncMock()))
    service._expire_abandoned = AsyncMock()
    service._active_run = AsyncMock(
        return_value=_completed_run(status="in_progress", thresholds={"a": 1.0})
    )

    with pytest.raises(SmurfBoostDetectionError) as raised:
        await service._claim_run("p", dict(CONSERVATIVE))
    assert raised.value.code == "analysis_in_progress"


async def test_an_identically_configured_active_run_is_attached_to() -> None:
    """Two viewers asking the same question share one computation."""
    active = _completed_run(status="in_progress")
    service = _service(MagicMock(execute=AsyncMock(), commit=AsyncMock()))
    service._expire_abandoned = AsyncMock()
    service._active_run = AsyncMock(return_value=active)

    created_at, concurrent = await service._claim_run("p", dict(CONSERVATIVE))
    assert created_at is None
    assert concurrent is active


async def test_an_abandoned_run_is_terminalized_rather_than_blocking() -> None:
    """An interrupted request must not wedge the feature for that player."""
    execute = AsyncMock(return_value=SimpleNamespace(rowcount=1))
    commit = AsyncMock()
    service = _service(MagicMock(execute=execute, commit=commit))

    await service._expire_abandoned("p")

    commit.assert_awaited_once()
    statement = str(_await_args(execute)[0])
    assert "SET status=" in statement
    assert "created_at <" in statement


async def test_nothing_is_committed_when_no_run_is_abandoned() -> None:
    """The expiry sweep runs on every request, so it must stay silent."""
    commit = AsyncMock()
    service = _service(
        MagicMock(
            execute=AsyncMock(return_value=SimpleNamespace(rowcount=0)), commit=commit
        )
    )

    await service._expire_abandoned("p")

    commit.assert_not_awaited()


async def test_novelty_counting_excludes_the_window_by_identifier() -> None:
    """Champion history is counted past the load cap, minus the exact window.

    Excluding by identifier rather than by a repeated offset means a match
    ingested between the two queries cannot shift what counts as recent.
    """
    execute = AsyncMock(return_value=SimpleNamespace(all=lambda: [(1, 40), (2, 3)]))
    service = _service(MagicMock(execute=execute))

    counts = await service._prior_champion_games("p", ["EUN1_9", "EUN1_8"])

    assert counts == {1: 40, 2: 3}
    compiled = str(
        _await_args(execute)[0].compile(
            dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}
        )
    ).replace("\n", " ")
    # The window itself is excluded, by the identifiers that were actually
    # scored rather than by a count the second query would have to re-derive.
    assert "NOT IN ('EUN1_9', 'EUN1_8')" in compiled
    assert "OFFSET" not in compiled.upper()
    # No cap on how far back the history reaches.
    assert "LIMIT" not in compiled.upper()


async def test_the_excluded_window_is_the_window_that_was_scored() -> None:
    """Novelty must exclude exactly the games the engine treats as recent."""
    eligible = _window(30)
    service = _service(MagicMock())
    service._load_eligible = AsyncMock(return_value=eligible)
    service._load_summoner_level = AsyncMock(return_value=300)
    service._load_rank_span_days = AsyncMock(return_value=None)
    service._prior_champion_games = AsyncMock(return_value={})
    service._count_eligible = AsyncMock(return_value=30)
    thresholds = dict(CONSERVATIVE) | {"recent_window_size": 12.0}

    await service._build_request("p", thresholds)

    passed = _await_args(service._prior_champion_games)[1]
    assert passed == [match.match_id for match in eligible[:12]]


def _row(**overrides: Any) -> tuple[SimpleNamespace, SimpleNamespace]:
    """One `(participant, match)` pair exactly as the load query returns it."""
    participant = SimpleNamespace(
        team_position="MIDDLE",
        champion_id=1,
        win=True,
        total_minions_killed=BASE_MINIONS,
        neutral_minions_killed=0,
        time_played=1800,
        **{**BASE_METRICS, **overrides},
    )
    match = SimpleNamespace(
        match_id="EUN1_1",
        game_start_timestamp=1,
        game_version="16.16.1",
        game_start_timestamp_source="riot_game_start",
        game_duration=1800,
    )
    return participant, match


def _no_rows() -> list[tuple[SimpleNamespace, SimpleNamespace]]:
    """An empty result set, shaped like the one the load query returns."""
    return []


async def test_a_match_carrying_an_unscorable_metric_is_dropped() -> None:
    """`NaN` survives standardization and clamps to the positive bound.

    Left in, one corrupt row reads as maximum performance and can push a band
    upward, which is the one direction this feature must never fail in.
    """
    assert clamp(float("nan"), -3.0, 3.0) == 3.0

    rows = [_row(), _row(kda=float("nan")), _row(gold_per_minute=float("inf"))]
    execute = AsyncMock(return_value=SimpleNamespace(all=lambda: rows))
    service = _service(MagicMock(execute=execute))

    loaded = await service._load_eligible("p")

    assert len(loaded) == 1
    assert loaded[0].kda == BASE_METRICS["kda"]


async def test_eligibility_is_one_predicate_every_query_reuses() -> None:
    """Eligibility lives only in SQL, so only SQL can assert it.

    Remakes, other queues, very short games and the `'Invalid'` position are all
    excluded here or nowhere: the engine never sees a reason to reject a match.
    """
    execute = AsyncMock(return_value=SimpleNamespace(all=_no_rows))
    service = _service(MagicMock(execute=execute))

    await service._load_eligible("p")

    compiled = str(
        _await_args(execute)[0].compile(
            dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}
        )
    ).replace("\n", " ")
    assert "match_participants.remake IS false" in compiled
    assert f"matches.queue_id = {RANKED_SOLO_QUEUE_ID}" in compiled
    assert f"matches.game_duration >= {MINIMUM_GAME_DURATION_SECONDS}" in compiled
    for position in RECOGNIZED_POSITIONS:
        assert f"'{position}'" in compiled
    assert "'Invalid'" not in compiled


async def test_the_load_cap_is_applied_in_sql() -> None:
    """A deep account must not hydrate hundreds of rows the engine discards."""
    execute = AsyncMock(return_value=SimpleNamespace(all=_no_rows))
    service = _service(MagicMock(execute=execute))

    await service._load_eligible("p")

    compiled = str(
        _await_args(execute)[0].compile(
            dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}
        )
    ).replace("\n", " ")
    assert f"LIMIT {MAX_WINDOW_MATCHES}" in compiled


async def test_polling_alone_terminalizes_an_abandoned_run() -> None:
    """The page offers no way to start a run while one still looks active.

    Without this sweep on the read path, an interrupted request leaves the
    client polling a run that will never finish.
    """
    service = _service(MagicMock())
    service._expire_abandoned = AsyncMock()
    service._newest_run = AsyncMock(return_value=None)

    assert await service.get_latest("p") is None
    service._expire_abandoned.assert_awaited_once_with("p")


async def test_a_race_loser_attaches_to_a_winner_that_already_finished() -> None:
    """The winner can complete before the loser looks for an active row.

    Re-raising the database error there would answer an ordinary duplicate
    request with a 500 instead of the result it asked for.
    """
    winner = _completed_run()
    service = _service(
        MagicMock(
            execute=AsyncMock(),
            commit=AsyncMock(side_effect=IntegrityError("insert", None, Exception())),
            rollback=AsyncMock(),
            add=MagicMock(),
        )
    )
    service._expire_abandoned = AsyncMock()
    service._active_run = AsyncMock(return_value=None)
    service._newest_run = AsyncMock(return_value=winner)

    created_at, concurrent = await service._claim_run("p", dict(CONSERVATIVE))

    assert created_at is None
    assert concurrent is winner


def test_a_run_that_cannot_be_read_back_is_not_the_caller_s_fault() -> None:
    """`analysis_missing` is a persistence invariant failure, not a bad body."""
    assert ERROR_STATUS_CODES["analysis_missing"] == 500
    assert ERROR_STATUS_CODES["analysis_in_progress"] == 409


def test_the_stored_result_carries_the_disclaimer_and_no_family_score() -> None:
    """The wire shape is the specified one, in one place, for both readers."""
    result = analyze(
        _request(_window(20, wins=10), _window(60, wins=30, start_index=20))
    )
    payload = _serialize(result)

    assert payload["disclaimer"] == DISCLAIMER
    for family in payload["families"]:
        assert "score" not in family
        for signal in family["signals"]:
            assert "signal_id" not in signal
            assert signal["id"] in SIGNAL_WEIGHTS
            assert signal["family"] == family["family"]


def test_an_out_of_range_stored_threshold_is_recovered_not_trusted() -> None:
    """A value the model cannot divide by must never reach the ramp."""
    recovered = resolve_thresholds(
        {"a1_step_change_threshold": 99.0, "recent_window_size": 25}
    )

    assert (
        recovered["a1_step_change_threshold"]
        == CONSERVATIVE["a1_step_change_threshold"]
    )
    assert recovered["recent_window_size"] == 25.0
    assert set(recovered) == set(CONSERVATIVE)
    for signal_id, saturation in SIGNAL_SATURATIONS.items():
        field = f"{signal_id.lower()}_step_change_threshold"
        if field in recovered:
            assert recovered[field] < saturation


def test_a_stored_set_breaking_a_cross_field_rule_is_recovered() -> None:
    """A3 must not be made permanently unreachable by a stored preference."""
    recovered = resolve_thresholds(
        {"recent_window_size": 10, "a3_minimum_novel_games": 15}
    )

    assert recovered["a3_minimum_novel_games"] <= recovered["recent_window_size"]


def test_every_preset_can_be_submitted_back_to_the_settings_api() -> None:
    """A client applying a preset must not have to reshape it first."""
    for name in PRESETS:
        payload = serialize_card_preference_settings(dict(PRESETS[name]))
        assert isinstance(payload["recentWindowSize"], int)
        validate_card_preference_update(CardId.SMURF_BOOST_DETECTION, payload)
