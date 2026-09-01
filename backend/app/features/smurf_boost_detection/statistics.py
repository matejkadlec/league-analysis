"""Pure statistical helpers for `smurf-boost/v1`.

The specification pins exact denominators, matched by `statistics`:
`pvariance` divides by n, `variance` by n - 1.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from statistics import fmean as mean
from statistics import pstdev, pvariance, variance

from .config import EPSILON

WILSON_Z: float = 1.96

# Re-exported under the names the signals read them by; aliased rather than
# imported under those names, which ruff's F401 reads as unused.
population_variance = pvariance
population_stdev = pstdev


def sample_variance(values: Sequence[float]) -> float:
    """Unbiased sample variance with denominator n - 1.

    A one-game window carries no dispersion, and `statistics.variance` raises
    there rather than saying so.
    """
    return variance(values) if len(values) >= 2 else 0.0


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


def hedges_g(recent: Sequence[float], baseline: Sequence[float]) -> float | None:
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


def bimodality_coefficient(values: Sequence[float]) -> float | None:
    """Bias-corrected bimodality coefficient.

    Skewness and excess kurtosis are standardized by the population second
    central moment; the sample standard deviation invalidates the threshold.

    Returns:
        None when there is no spread.
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


def log2_ratio(numerator: float, denominator: float) -> float | None:
    """Absolute base-2 log of a ratio, or None when it is undefined."""
    if numerator <= EPSILON or denominator <= EPSILON:
        return None
    return abs(math.log2(numerator / denominator))


def clamp(value: float, lower: float, upper: float) -> float:
    """Constrain a value to a closed interval."""
    return max(lower, min(upper, value))
