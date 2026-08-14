"""The eight `smurf-boost/v1` signals.

Each signal is a pure function of one `SignalInputs` bundle. A signal either
produces a result or reports itself unavailable with a reason; an unavailable
signal never triggers, never scores, and never counts as evidence.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from .composite import CompositeContext, EligibleMatch
from .config import (
    B3_HIGH_CUT,
    B3_LOW_CUT,
    EPSILON,
    MIN_MAGNITUDE,
    MINIMUM_SHAPE_GAMES,
    NOVEL_CHAMPION_MAX_PRIOR_GAMES,
    SIGNAL_SATURATIONS,
    SIGNAL_WEIGHTS,
)
from .statistics import (
    bimodality_coefficient,
    clamp,
    hedges_g,
    log2_ratio,
    mean,
    population_stdev,
    population_variance,
    wilson_lower_bound,
)

NOTE_DEGENERATE_BASELINE = "degenerate_baseline"
NOTE_INSUFFICIENT_NOVEL_SAMPLE = "insufficient_novel_sample"
NOTE_INSUFFICIENT_SHAPE_SAMPLE = "insufficient_shape_sample"
NOTE_NOVEL_IS_STORAGE_SCOPED = "novel_is_storage_scoped"
NOTE_SUMMONER_LEVEL_UNKNOWN = "summoner_level_unknown"
NOTE_WEAK_ACCOUNT_AGE_PROXY = "weak_account_age_proxy"
NOTE_UNDEFINED_STATISTIC = "undefined_statistic"


@dataclass(frozen=True)
class SignalResult:
    """One signal's complete, explainable outcome."""

    signal_id: str
    available: bool
    triggered: bool
    sample_size: int
    reason: str
    notes: tuple[str, ...]
    raw_value: Optional[float] = None
    threshold: Optional[float] = None
    saturation: Optional[float] = None
    magnitude: Optional[float] = None
    weight: Optional[float] = None
    contribution: Optional[float] = None


@dataclass(frozen=True)
class SignalInputs:
    """Everything the eight signals read, computed once per analysis."""

    recent: list[EligibleMatch]
    baseline: list[EligibleMatch]
    composite_recent: list[float]
    composite_baseline: list[float]
    prior_champion_games: dict[int, int]
    summoner_level: Optional[int]
    context: CompositeContext
    thresholds: dict[str, float]

    @property
    def recent_wins(self) -> int:
        """Wins in the recent window."""
        return sum(1 for match in self.recent if match.win)

    @property
    def baseline_wins(self) -> int:
        """Wins in the baseline window."""
        return sum(1 for match in self.baseline if match.win)

    @property
    def recent_win_rate(self) -> float:
        """Recent window win rate."""
        return self.recent_wins / len(self.recent)

    @property
    def baseline_win_rate(self) -> float:
        """Baseline window win rate."""
        return self.baseline_wins / len(self.baseline)


def _unavailable(
    signal_id: str, reason: str, note: str, sample_size: int = 0
) -> SignalResult:
    """Build the record for a signal that could not be computed."""
    return SignalResult(
        signal_id=signal_id,
        available=False,
        triggered=False,
        sample_size=sample_size,
        reason=reason,
        notes=(note,),
    )


def _scored(
    signal_id: str,
    raw_value: float,
    threshold: float,
    triggered: bool,
    sample_size: int,
    reason: str,
    notes: tuple[str, ...] = (),
) -> SignalResult:
    """Build the record for a computed signal, applying the magnitude ramp."""
    saturation = SIGNAL_SATURATIONS[signal_id]
    weight = SIGNAL_WEIGHTS[signal_id]
    ramp = clamp((raw_value - threshold) / (saturation - threshold), 0.0, 1.0)
    magnitude = max(ramp, MIN_MAGNITUDE) if triggered else 0.0
    return SignalResult(
        signal_id=signal_id,
        available=True,
        triggered=triggered,
        sample_size=sample_size,
        reason=reason,
        notes=notes,
        raw_value=raw_value,
        threshold=threshold,
        saturation=saturation,
        magnitude=magnitude,
        weight=weight,
        contribution=weight * magnitude,
    )


def evaluate_a1(inputs: SignalInputs) -> SignalResult:
    """A1 - performance step change between the two windows."""
    if inputs.context.degenerate:
        return _unavailable(
            "A1",
            "Recent performance could not be compared: every earlier game scored "
            "identically, so there is no baseline spread to measure against.",
            NOTE_DEGENERATE_BASELINE,
        )

    value = hedges_g(inputs.composite_recent, inputs.composite_baseline)
    if value is None:
        return _unavailable(
            "A1",
            "Recent performance could not be compared because the combined "
            "windows have no measurable spread.",
            NOTE_UNDEFINED_STATISTIC,
            sample_size=len(inputs.recent),
        )

    threshold = inputs.thresholds["a1_step_change_threshold"]
    triggered = value >= threshold
    return _scored(
        "A1",
        value,
        threshold,
        triggered,
        len(inputs.recent),
        f"Recent {len(inputs.recent)} games scored {value:+.2f} standardized units "
        f"against the previous {len(inputs.baseline)}.",
    )


def evaluate_a2(inputs: SignalInputs) -> SignalResult:
    """A2 - win-rate surge guarded by a Wilson lower bound."""
    guarded = wilson_lower_bound(inputs.recent_wins, len(inputs.recent))
    value = guarded - inputs.baseline_win_rate
    threshold = inputs.thresholds["a2_win_rate_surge_threshold"]
    return _scored(
        "A2",
        value,
        threshold,
        value >= threshold,
        len(inputs.recent),
        f"Recent win rate {inputs.recent_win_rate:.0%} over {len(inputs.recent)} "
        f"games against {inputs.baseline_win_rate:.0%} over "
        f"{len(inputs.baseline)}; the small-sample guard puts the recent figure "
        f"no lower than {guarded:.0%}.",
    )


def _novel_scores(inputs: SignalInputs) -> list[float]:
    """Composite scores for recent games on rarely played champions."""
    return [
        score
        for match, score in zip(inputs.recent, inputs.composite_recent)
        if inputs.prior_champion_games.get(match.champion_id, 0)
        <= NOVEL_CHAMPION_MAX_PRIOR_GAMES
    ]


def evaluate_a3(inputs: SignalInputs) -> SignalResult:
    """A3 - overperformance on champions with little stored history."""
    if inputs.context.degenerate:
        return _unavailable(
            "A3",
            "New-champion results could not be compared without a baseline spread.",
            NOTE_DEGENERATE_BASELINE,
        )

    scores = _novel_scores(inputs)
    minimum = int(inputs.thresholds["a3_minimum_novel_games"])
    if len(scores) < minimum:
        return _unavailable(
            "A3",
            f"Only {len(scores)} of the recent games were on champions with little "
            f"stored history; {minimum} are needed.",
            NOTE_INSUFFICIENT_NOVEL_SAMPLE,
            sample_size=len(scores),
        )

    value = mean(scores) - mean(inputs.composite_baseline)
    threshold = inputs.thresholds["a3_novel_champion_threshold"]
    return _scored(
        "A3",
        value,
        threshold,
        value >= threshold,
        len(scores),
        f"{len(scores)} recent games on rarely played champions scored "
        f"{value:+.2f} standardized units against the baseline.",
        (NOTE_NOVEL_IS_STORAGE_SCOPED,),
    )


def evaluate_a4(inputs: SignalInputs) -> SignalResult:
    """A4 - strong recent play on a low-level account."""
    if inputs.context.degenerate:
        return _unavailable(
            "A4",
            "Recent performance could not be measured without a baseline spread.",
            NOTE_DEGENERATE_BASELINE,
        )
    if inputs.summoner_level is None:
        return _unavailable(
            "A4",
            "The account level is not stored, so it cannot be considered.",
            NOTE_SUMMONER_LEVEL_UNKNOWN,
        )

    gate = int(inputs.thresholds["a4_summoner_level_gate"])
    value = mean(inputs.composite_recent)
    threshold = inputs.thresholds["a4_performance_threshold"]
    triggered = inputs.summoner_level <= gate and value >= threshold
    return _scored(
        "A4",
        value,
        threshold,
        triggered,
        len(inputs.recent),
        f"Account level {inputs.summoner_level} against a gate of {gate}, with "
        f"recent games at {value:+.2f} standardized units.",
        (NOTE_WEAK_ACCOUNT_AGE_PROXY,),
    )


def evaluate_b1(inputs: SignalInputs) -> SignalResult:
    """B1 - win-rate surge that per-game performance does not explain."""
    if inputs.context.degenerate:
        return _unavailable(
            "B1",
            "The win-rate change could not be compared against performance "
            "without a baseline spread.",
            NOTE_DEGENERATE_BASELINE,
        )

    win_rate_delta = inputs.recent_win_rate - inputs.baseline_win_rate
    composite_delta = mean(inputs.composite_recent) - mean(inputs.composite_baseline)
    threshold = inputs.thresholds["b1_win_rate_delta_threshold"]
    ceiling = inputs.thresholds["b1_composite_flat_ceiling"]
    triggered = win_rate_delta >= threshold and composite_delta <= ceiling
    return _scored(
        "B1",
        win_rate_delta,
        threshold,
        triggered,
        len(inputs.recent),
        f"Win rate moved {win_rate_delta:+.0%} while per-game performance moved "
        f"{composite_delta:+.2f} standardized units.",
    )


def evaluate_b2(inputs: SignalInputs) -> SignalResult:
    """B2 - change in how consistent the per-game results are."""
    if inputs.context.degenerate:
        return _unavailable(
            "B2",
            "Consistency could not be compared without a baseline spread.",
            NOTE_DEGENERATE_BASELINE,
        )

    recent_spread = population_stdev(inputs.composite_recent)
    baseline_spread = population_stdev(inputs.composite_baseline)
    value = log2_ratio(recent_spread, baseline_spread)
    if value is None:
        return _unavailable(
            "B2",
            "Consistency could not be compared: the recent games have no spread.",
            NOTE_UNDEFINED_STATISTIC,
            sample_size=len(inputs.recent),
        )

    threshold = inputs.thresholds["b2_consistency_shift_threshold"]
    direction = "narrower" if recent_spread < baseline_spread else "wider"
    return _scored(
        "B2",
        value,
        threshold,
        value >= threshold,
        len(inputs.recent),
        f"Recent results are {direction} than the baseline by {value:.2f} "
        f"doublings of spread.",
    )


def _b3_unavailable(inputs: SignalInputs) -> Optional[SignalResult]:
    """Why the shape of the recent window cannot be measured, if it cannot."""
    if inputs.context.degenerate:
        return _unavailable(
            "B3",
            "The shape of recent results could not be measured without a "
            "baseline spread.",
            NOTE_DEGENERATE_BASELINE,
        )
    total = len(inputs.composite_recent)
    if total < MINIMUM_SHAPE_GAMES:
        return _unavailable(
            "B3",
            f"At least {MINIMUM_SHAPE_GAMES} recent games are needed to measure "
            f"the shape of the results; there are {total}.",
            NOTE_INSUFFICIENT_SHAPE_SAMPLE,
            sample_size=total,
        )
    if bimodality_coefficient(inputs.composite_recent) is None:
        # The specification separates a recent window with no spread at all,
        # which is a sample problem, from an estimator that is undefined for
        # some other reason.
        no_spread = population_variance(inputs.composite_recent) <= EPSILON
        return _unavailable(
            "B3",
            "The shape of recent results could not be measured because they have "
            "no spread.",
            NOTE_INSUFFICIENT_SHAPE_SAMPLE if no_spread else NOTE_UNDEFINED_STATISTIC,
            sample_size=total,
        )
    return None


def evaluate_b3(inputs: SignalInputs) -> SignalResult:
    """B3 - strong and weak games both present in the recent window."""
    unavailable = _b3_unavailable(inputs)
    if unavailable is not None:
        return unavailable

    coefficient = bimodality_coefficient(inputs.composite_recent)
    assert coefficient is not None
    total = len(inputs.composite_recent)
    high = sum(1 for score in inputs.composite_recent if score >= B3_HIGH_CUT) / total
    low = sum(1 for score in inputs.composite_recent if score <= B3_LOW_CUT) / total
    threshold = inputs.thresholds["b3_bimodality_threshold"]
    tail = inputs.thresholds["b3_tail_fraction"]
    triggered = coefficient > threshold and high >= tail and low >= tail
    return _scored(
        "B3",
        coefficient,
        threshold,
        triggered,
        total,
        f"{high:.0%} of recent games were well above the baseline and {low:.0%} "
        f"were at or below it.",
    )


def _half_win_rates(inputs: SignalInputs) -> Optional[tuple[float, float]]:
    """Win rate of the older and newer halves of the recent window.

    The window is ordered newest first, so the older half is the tail. An odd
    window gives the extra match to the older half and discards nothing.
    """
    total = len(inputs.recent)
    if total < 2:
        return None
    newer_size = total // 2
    newer = inputs.recent[:newer_size]
    older = inputs.recent[newer_size:]
    older_rate = sum(1 for match in older if match.win) / len(older)
    newer_rate = sum(1 for match in newer if match.win) / len(newer)
    return older_rate, newer_rate


def evaluate_b4(inputs: SignalInputs) -> SignalResult:
    """B4 - a sustained drop from a previously high win rate."""
    halves = _half_win_rates(inputs)
    if halves is None:
        return _unavailable(
            "B4",
            "The recent window is too short to check whether a drop was sustained.",
            NOTE_INSUFFICIENT_SHAPE_SAMPLE,
            sample_size=len(inputs.recent),
        )

    older_rate, newer_rate = halves
    baseline_rate = inputs.baseline_win_rate
    drop = baseline_rate - inputs.recent_win_rate
    floor = inputs.thresholds["b4_high_rate_floor"]
    threshold = inputs.thresholds["b4_drop_threshold"]
    sustained = (
        older_rate <= baseline_rate - 0.05 and newer_rate <= baseline_rate - 0.05
    )
    triggered = baseline_rate >= floor and drop >= threshold and sustained
    return _scored(
        "B4",
        drop,
        threshold,
        triggered,
        len(inputs.recent),
        f"Win rate fell {drop:.0%} from a baseline of {baseline_rate:.0%}; the "
        f"two halves of the recent window sit at {older_rate:.0%} and "
        f"{newer_rate:.0%}.",
    )


FAMILY_A_EVALUATORS = (evaluate_a1, evaluate_a2, evaluate_a3, evaluate_a4)
FAMILY_B_EVALUATORS = (evaluate_b1, evaluate_b2, evaluate_b3, evaluate_b4)
