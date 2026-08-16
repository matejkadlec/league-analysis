"""Role-normalized composite performance score for `smurf-boost/v1`.

The composite is the single per-match performance number every location, spread
and shape signal reads. It is standardized against the baseline window so that
`mean(C_B) = 0` and `sd(C_B) = 1` exactly, which is what makes a threshold
expressed in "baseline standard deviations" literally true.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .config import (
    COMPOSITE_WEIGHTS,
    EPSILON,
    MINIMUM_ROLE_BASELINE_GAMES,
    SIGMA_RELATIVE_FLOOR,
    Z_CLAMP,
)
from .statistics import clamp, mean, population_stdev

NOTE_ROLE_BASELINE_POOLED = "role_baseline_pooled"
NOTE_TIME_PLAYED_MISSING = "time_played_missing"


@dataclass(frozen=True)
class EligibleMatch:
    """One stored ranked game that passed the eligibility filter."""

    match_id: str
    game_start_timestamp: int
    game_version: str
    timestamp_source: str
    team_position: str
    champion_id: int
    win: bool
    kda: float
    gold_per_minute: float
    kill_participation: float
    team_damage_percentage: float
    vision_score_per_minute: float
    total_minions_killed: int
    neutral_minions_killed: int
    time_played: int
    game_duration: int

    @property
    def minutes(self) -> float:
        """Playing time in minutes, falling back to the match duration."""
        seconds = self.time_played if self.time_played > 0 else self.game_duration
        return seconds / 60.0

    @property
    def cs_per_minute(self) -> float:
        """Minions and monsters killed per minute."""
        return (self.total_minions_killed + self.neutral_minions_killed) / self.minutes

    def metric(self, name: str) -> float:
        """Read one composite metric by its canonical name."""
        if name == "cs_per_minute":
            return self.cs_per_minute
        return float(getattr(self, name))


@dataclass(frozen=True)
class MetricStats:
    """Mean and effective standard deviation for one metric."""

    center: float
    spread: float


@dataclass
class CompositeContext:
    """Baseline statistics needed to score any match on the same scale."""

    pooled: dict[str, MetricStats]
    per_role: dict[str, dict[str, MetricStats]]
    baseline_center: float
    baseline_spread: float
    degenerate: bool
    notes: set[str] = field(default_factory=set[str])


def _effective_spread(center: float, spread: float) -> float:
    """Floor the standard deviation so a z-score is always defined."""
    return max(spread, SIGMA_RELATIVE_FLOOR * abs(center), EPSILON)


def _stats_for(matches: list[EligibleMatch]) -> dict[str, MetricStats]:
    """Mean and floored standard deviation of every composite metric."""
    stats: dict[str, MetricStats] = {}
    for name in COMPOSITE_WEIGHTS:
        values = [match.metric(name) for match in matches]
        center = mean(values)
        spread = population_stdev(values) if len(values) > 1 else 0.0
        stats[name] = MetricStats(
            center=center, spread=_effective_spread(center, spread)
        )
    return stats


def _raw_composite(
    match: EligibleMatch, context_stats: dict[str, MetricStats]
) -> float:
    """Weighted sum of clamped z-scores for one match."""
    total = 0.0
    for name, weight in COMPOSITE_WEIGHTS.items():
        stats = context_stats[name]
        z = (match.metric(name) - stats.center) / stats.spread
        total += weight * clamp(z, -Z_CLAMP, Z_CLAMP)
    return total


def _stats_by_role(
    baseline: list[EligibleMatch],
    roles: set[str],
    pooled: dict[str, MetricStats],
) -> tuple[dict[str, dict[str, MetricStats]], bool]:
    """Per-role statistics, falling back to the pooled baseline when thin."""
    grouped: dict[str, list[EligibleMatch]] = {}
    for match in baseline:
        grouped.setdefault(match.team_position, []).append(match)

    per_role: dict[str, dict[str, MetricStats]] = {}
    pooled_used = False
    for role in roles:
        role_matches = grouped.get(role, [])
        if len(role_matches) < MINIMUM_ROLE_BASELINE_GAMES:
            per_role[role] = pooled
            pooled_used = True
            continue
        per_role[role] = _stats_for(role_matches)
    return per_role, pooled_used


def build_context(
    recent: list[EligibleMatch], baseline: list[EligibleMatch]
) -> CompositeContext:
    """Derive every baseline statistic the composite depends on."""
    pooled = _stats_for(baseline)
    roles = {match.team_position for match in recent + baseline}
    per_role, pooled_used = _stats_by_role(baseline, roles, pooled)

    raw_baseline = [
        _raw_composite(match, per_role[match.team_position]) for match in baseline
    ]
    center = mean(raw_baseline)
    spread = population_stdev(raw_baseline) if len(raw_baseline) > 1 else 0.0

    notes: set[str] = set()
    if pooled_used:
        notes.add(NOTE_ROLE_BASELINE_POOLED)
    if any(match.time_played <= 0 for match in recent + baseline):
        notes.add(NOTE_TIME_PLAYED_MISSING)

    return CompositeContext(
        pooled=pooled,
        per_role=per_role,
        baseline_center=center,
        baseline_spread=spread,
        degenerate=spread <= EPSILON,
        notes=notes,
    )


def standardized_series(
    matches: list[EligibleMatch], context: CompositeContext
) -> list[float]:
    """Composite scores for a window, empty when the baseline is degenerate."""
    if context.degenerate:
        return []
    return [
        (
            _raw_composite(
                match, context.per_role.get(match.team_position, context.pooled)
            )
            - context.baseline_center
        )
        / context.baseline_spread
        for match in matches
    ]
