"""Pure orchestration for `smurf-boost/v1`.

This module turns eligible matches plus a threshold set into an explained
result. It touches no database, makes no Riot call, and is deterministic.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field

from .composite import (
    CompositeContext,
    EligibleMatch,
    build_context,
    standardized_series,
)
from .config import (
    BAND_NONE,
    BAND_NOT_ENOUGH_DATA,
    BAND_NOTABLE,
    BAND_STRONG,
    BAND_WEAK,
    CONFIDENCE_HIGH,
    CONFIDENCE_MEDIUM,
    EVIDENCE_GROUPS,
    LEGACY_TIMESTAMP_FACTOR,
    MINIMUM_BASELINE_GAMES,
    MINIMUM_RECENT_GAMES,
    MODEL_VERSION,
    NOTABLE_EVIDENCE,
    NOTABLE_SCORE,
    PATCH_DISJOINT_FACTOR,
    RANK_SPAN_BONUS,
    RANK_SPAN_TARGET_DAYS,
    STRONG_EVIDENCE,
    STRONG_SCORE,
)
from .schemas import ConfidenceBand, SmurfBoostBand
from .signals import (
    FAMILY_A_EVALUATORS,
    FAMILY_B_EVALUATORS,
    SignalInputs,
    SignalResult,
)
from .statistics import clamp

NOTE_PATCH_DISJOINT = "patch_disjoint_windows"
NOTE_LEGACY_TIMESTAMPS = "legacy_game_start_timestamps"
NOTE_RANK_UNAVAILABLE = "rank_corroboration_unavailable"

RIOT_GAME_START = "riot_game_start"

FAMILY_A = "rapid_improvement"
FAMILY_B = "playing_pattern_change"


@dataclass(frozen=True)
class FamilyResult:
    """One family's band, score and explained signals."""

    family: str
    band: SmurfBoostBand
    score: float
    distinct_evidence: int
    signals: tuple[SignalResult, ...]


@dataclass(frozen=True)
class DetectionResult:
    """The complete outcome of one analysis."""

    model_version: str
    families: tuple[FamilyResult, ...]
    confidence: float
    confidence_band: ConfidenceBand
    recent_games: int
    baseline_games: int
    eligible_games: int
    notes: tuple[str, ...]


@dataclass(frozen=True)
class AnalysisRequest:
    """Everything one analysis needs, already loaded from storage."""

    eligible: list[EligibleMatch]
    summoner_level: int | None
    rank_span_days: float | None
    thresholds: dict[str, float]
    prior_champion_games: dict[int, int] = field(default_factory=dict[int, int])
    total_eligible_games: int | None = None

    @property
    def eligible_total(self) -> int:
        """Every eligible game the player has, not just the loaded slice.

        The service caps how many matches it loads for performance, so the
        loaded list can be shorter than the player's real history. Reporting
        the slice length would understate the history and would make a
        staleness comparison against it meaningless.
        """
        if self.total_eligible_games is None:
            return len(self.eligible)
        return self.total_eligible_games


def split_windows(
    eligible: Sequence[EligibleMatch], recent_size: int, baseline_size: int
) -> tuple[list[EligibleMatch], list[EligibleMatch]]:
    """Split newest-first eligible matches into non-overlapping windows."""
    recent = list(eligible[:recent_size])
    baseline = list(eligible[recent_size : recent_size + baseline_size])
    return recent, baseline


def _major_minor(game_version: str) -> str:
    """Leading `major.minor` of a patch string."""
    parts = game_version.split(".")
    return ".".join(parts[:2])


def _confidence_notes(
    recent: Sequence[EligibleMatch],
    baseline: Sequence[EligibleMatch],
    rank_span_days: float | None,
) -> tuple[float, set[str]]:
    """Multiplicative confidence factors from data quality alone."""
    notes: set[str] = set()
    factor = 1.0

    recent_patches = {_major_minor(match.game_version) for match in recent}
    baseline_patches = {_major_minor(match.game_version) for match in baseline}
    if not recent_patches & baseline_patches:
        factor *= PATCH_DISJOINT_FACTOR
        notes.add(NOTE_PATCH_DISJOINT)

    if any(
        match.timestamp_source != RIOT_GAME_START
        for match in list(recent) + list(baseline)
    ):
        factor *= LEGACY_TIMESTAMP_FACTOR
        notes.add(NOTE_LEGACY_TIMESTAMPS)

    if rank_span_days is None:
        notes.add(NOTE_RANK_UNAVAILABLE)
    else:
        factor *= 1.0 + RANK_SPAN_BONUS * min(
            1.0, rank_span_days / RANK_SPAN_TARGET_DAYS
        )

    return factor, notes


def _confidence_band(confidence: float) -> ConfidenceBand:
    """Map a confidence value onto its half-open band."""
    if confidence < CONFIDENCE_MEDIUM:
        return "low"
    if confidence < CONFIDENCE_HIGH:
        return "medium"
    return "high"


def _band_for(score: float, evidence: int, any_triggered: bool) -> SmurfBoostBand:
    """Assign a family band from its score and distinct evidence count."""
    if not any_triggered:
        return BAND_NONE
    if score >= STRONG_SCORE and evidence >= STRONG_EVIDENCE:
        return BAND_STRONG
    if score >= NOTABLE_SCORE and evidence >= NOTABLE_EVIDENCE:
        return BAND_NOTABLE
    return BAND_WEAK


def _evaluate_family(
    family: str,
    evaluators: Sequence[Callable[[SignalInputs], SignalResult]],
    inputs: SignalInputs,
) -> FamilyResult:
    """Run one family's signals and derive its band."""
    results = tuple(evaluate(inputs) for evaluate in evaluators)
    triggered = [result for result in results if result.triggered]
    score = sum(result.contribution or 0.0 for result in triggered)
    groups = {EVIDENCE_GROUPS[result.signal_id] for result in triggered}
    return FamilyResult(
        family=family,
        band=_band_for(score, len(groups), bool(triggered)),
        score=round(score, 4),
        distinct_evidence=len(groups),
        signals=results,
    )


def _not_enough_data(
    request: AnalysisRequest,
    recent: Sequence[EligibleMatch],
    baseline: Sequence[EligibleMatch],
) -> DetectionResult:
    """Build the first-class insufficient-data outcome."""
    families = tuple(
        FamilyResult(
            family=name,
            band=BAND_NOT_ENOUGH_DATA,
            score=0.0,
            distinct_evidence=0,
            signals=(),
        )
        for name in (FAMILY_A, FAMILY_B)
    )
    return DetectionResult(
        model_version=MODEL_VERSION,
        families=families,
        confidence=0.0,
        confidence_band="low",
        recent_games=len(recent),
        baseline_games=len(baseline),
        eligible_games=request.eligible_total,
        notes=(),
    )


def _coverage(
    recent: Sequence[EligibleMatch],
    baseline: Sequence[EligibleMatch],
    thresholds: dict[str, float],
) -> float:
    """How completely the configured windows were filled."""
    target_recent = max(1, int(thresholds["recent_window_size"]))
    target_baseline = max(1, int(thresholds["baseline_window_size"]))
    return min(1.0, len(recent) / target_recent) * min(
        1.0, len(baseline) / target_baseline
    )


def _context_and_series(
    recent: list[EligibleMatch], baseline: list[EligibleMatch]
) -> tuple[CompositeContext, list[float], list[float]]:
    """Build the composite context and both standardized windows."""
    context = build_context(recent, baseline)
    return (
        context,
        standardized_series(recent, context),
        standardized_series(baseline, context),
    )


def analyze(request: AnalysisRequest) -> DetectionResult:
    """Run the complete model over one player's eligible history."""
    recent_size = int(request.thresholds["recent_window_size"])
    baseline_size = int(request.thresholds["baseline_window_size"])
    recent, baseline = split_windows(request.eligible, recent_size, baseline_size)

    if len(recent) < MINIMUM_RECENT_GAMES or len(baseline) < MINIMUM_BASELINE_GAMES:
        return _not_enough_data(request, recent, baseline)

    context, composite_recent, composite_baseline = _context_and_series(
        recent, baseline
    )
    inputs = SignalInputs(
        recent=recent,
        baseline=baseline,
        composite_recent=composite_recent,
        composite_baseline=composite_baseline,
        prior_champion_games=request.prior_champion_games,
        summoner_level=request.summoner_level,
        context=context,
        thresholds=request.thresholds,
    )

    families = (
        _evaluate_family(FAMILY_A, FAMILY_A_EVALUATORS, inputs),
        _evaluate_family(FAMILY_B, FAMILY_B_EVALUATORS, inputs),
    )

    quality_factor, quality_notes = _confidence_notes(
        recent, baseline, request.rank_span_days
    )
    confidence = clamp(
        _coverage(recent, baseline, request.thresholds) * quality_factor, 0.0, 1.0
    )

    return DetectionResult(
        model_version=MODEL_VERSION,
        families=families,
        confidence=round(confidence, 4),
        confidence_band=_confidence_band(confidence),
        recent_games=len(recent),
        baseline_games=len(baseline),
        eligible_games=request.eligible_total,
        notes=tuple(sorted(quality_notes | context.notes)),
    )
