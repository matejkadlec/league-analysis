"""Pure statistical helpers for `smurf-boost/v1`.

Every estimator is spelled out rather than delegated, because library defaults
differ on skewness, kurtosis and variance denominators and the specification
pins exact choices.
"""

from __future__ import annotations

import math
from typing import Optional, Sequence

from .config import EPSILON

WILSON_Z: float = 1.96


def mean(values: Sequence[float]) -> float:
    """Arithmetic mean of a non-empty sequence."""
    return sum(values) / len(values)


def population_variance(values: Sequence[float]) -> float:
    """Second central moment with denominator n."""
    center = mean(values)
    return sum((value - center) ** 2 for value in values) / len(values)


def population_stdev(values: Sequence[float]) -> float:
    """Population standard deviation with denominator n."""
    return math.sqrt(population_variance(values))


def sample_variance(values: Sequence[float]) -> float:
    """Unbiased sample variance with denominator n - 1."""
    if len(values) < 2:
        return 0.0
    center = mean(values)
    return sum((value - center) ** 2 for value in values) / (len(values) - 1)


def central_moment(values: Sequence[float], order: int) -> float:
    """Central moment of the given order with denominator n."""
    center = mean(values)
    return sum((value - center) ** order for value in values) / len(values)


def wilson_lower_bound(successes: int, trials: int) -> float:
    """Lower bound of the Wilson score interval at 95 percent."""
    if trials <= 0:
        return 0.0
    proportion = successes / trials
    z_squared = WILSON_Z * WILSON_Z
    centre = proportion + z_squared / (2 * trials)
    margin = WILSON_Z * math.sqrt(
        proportion * (1 - proportion) / trials + z_squared / (4 * trials * trials)
    )
    return (centre - margin) / (1 + z_squared / trials)


def hedges_g(recent: Sequence[float], baseline: Sequence[float]) -> Optional[float]:
    """Standardized mean difference with the Hedges small-sample correction.

    Both variances are unbiased sample variances. Returns None when the pooled
    standard deviation is zero, which makes the statistic undefined.
    """
    n_recent, n_baseline = len(recent), len(baseline)
    if n_recent + n_baseline <= 2:
        return None

    pooled_variance = (
        (n_recent - 1) * sample_variance(recent)
        + (n_baseline - 1) * sample_variance(baseline)
    ) / (n_recent + n_baseline - 2)
    pooled = math.sqrt(pooled_variance)
    if pooled <= EPSILON:
        return None

    correction = 1 - 3 / (4 * (n_recent + n_baseline) - 9)
    return correction * (mean(recent) - mean(baseline)) / pooled


def bimodality_coefficient(values: Sequence[float]) -> Optional[float]:
    """Bias-corrected bimodality coefficient.

    Skewness and excess kurtosis are standardized by the population second
    central moment, not by the sample standard deviation. Mixing the two
    produces a different statistic and would invalidate the calibrated
    threshold. Returns None when the sample is too small or has no spread.
    """
    n = len(values)
    if n < 4:
        return None

    m2 = central_moment(values, 2)
    if m2 <= EPSILON:
        return None

    m3 = central_moment(values, 3)
    m4 = central_moment(values, 4)

    skewness = (m3 / m2**1.5) * math.sqrt(n * (n - 1)) / (n - 2)
    excess_kurtosis = ((n - 1) * ((n + 1) * (m4 / m2**2 - 3) + 6)) / ((n - 2) * (n - 3))

    denominator = excess_kurtosis + 3 * (n - 1) ** 2 / ((n - 2) * (n - 3))
    if abs(denominator) <= EPSILON:
        return None
    return (skewness**2 + 1) / denominator


def log2_ratio(numerator: float, denominator: float) -> Optional[float]:
    """Absolute base-2 log of a ratio, or None when it is undefined."""
    if numerator <= EPSILON or denominator <= EPSILON:
        return None
    return abs(math.log2(numerator / denominator))


def clamp(value: float, lower: float, upper: float) -> float:
    """Constrain a value to a closed interval."""
    return max(lower, min(upper, value))
