"""Fixed model constants for `smurf-boost/v1`.

Everything in this module is part of the versioned model and is deliberately not
user-configurable. This module is the authority for them; changing any
value here requires a new model version.
"""

from __future__ import annotations

from typing import Final

MODEL_VERSION: Final[str] = "smurf-boost/v1"

# Eligibility. A match must be ranked solo/duo, not a remake, long enough to
# carry performance information, and played in a recognized position.
ELIGIBLE_QUEUE_ID: Final[int] = 420
MINIMUM_GAME_DURATION_SECONDS: Final[int] = 300
RECOGNIZED_POSITIONS: Final[frozenset[str]] = frozenset(
    {"TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"}
)

# Sample floors. These are correctness constraints, not preferences.
MINIMUM_RECENT_GAMES: Final[int] = 10
MINIMUM_BASELINE_GAMES: Final[int] = 15
MINIMUM_SHAPE_GAMES: Final[int] = 12

# Composite construction.
EPSILON: Final[float] = 1e-9
Z_CLAMP: Final[float] = 3.0
SIGMA_RELATIVE_FLOOR: Final[float] = 0.05
MINIMUM_ROLE_BASELINE_GAMES: Final[int] = 5
COMPOSITE_WEIGHTS: Final[dict[str, float]] = {
    "kda": 0.25,
    "gold_per_minute": 0.20,
    "kill_participation": 0.15,
    "team_damage_percentage": 0.15,
    "cs_per_minute": 0.15,
    "vision_score_per_minute": 0.10,
}

# Scoring. A triggered signal always contributes at least this share of its
# weight, so a signal shown to the user can never score exactly zero.
MIN_MAGNITUDE: Final[float] = 0.10

SIGNAL_WEIGHTS: Final[dict[str, float]] = {
    "A1": 0.30,
    "A2": 0.25,
    "A3": 0.25,
    "A4": 0.20,
    "B1": 0.30,
    "B2": 0.25,
    "B3": 0.20,
    "B4": 0.25,
}

SIGNAL_SATURATIONS: Final[dict[str, float]] = {
    "A1": 3.00,
    "A2": 0.50,
    "A3": 3.00,
    "A4": 3.00,
    "B1": 0.60,
    "B2": 2.00,
    "B3": 0.90,
    "B4": 0.60,
}

# Signals reading the same statistic are one unit of evidence, not several.
EVIDENCE_GROUPS: Final[dict[str, str]] = {
    "A1": "location",
    "A4": "location",
    "A3": "novel_subset",
    "A2": "win_rate",
    "B1": "win_rate",
    "B4": "win_rate",
    "B2": "spread",
    "B3": "shape",
}

# Band thresholds.
NOTABLE_SCORE: Final[float] = 0.40
NOTABLE_EVIDENCE: Final[int] = 2
STRONG_SCORE: Final[float] = 0.65
STRONG_EVIDENCE: Final[int] = 3

BAND_NOT_ENOUGH_DATA: Final[str] = "not_enough_data"
BAND_NONE: Final[str] = "no_unusual_pattern"
BAND_WEAK: Final[str] = "weak_indicators"
BAND_NOTABLE: Final[str] = "notable_indicators"
BAND_STRONG: Final[str] = "strong_indicators"

# Confidence.
PATCH_DISJOINT_FACTOR: Final[float] = 0.85
LEGACY_TIMESTAMP_FACTOR: Final[float] = 0.90
RANK_SPAN_BONUS: Final[float] = 0.05
RANK_SPAN_TARGET_DAYS: Final[float] = 30.0
CONFIDENCE_MEDIUM: Final[float] = 0.50
CONFIDENCE_HIGH: Final[float] = 0.80

# Threshold presets. Conservative is the shipped default. Every value sits
# strictly below its signal's saturation, so the magnitude ramp never divides by
# zero or by a negative number.
PRESET_CONSERVATIVE: Final[str] = "conservative"
PRESET_BALANCED: Final[str] = "balanced"
PRESET_SENSITIVE: Final[str] = "sensitive"

PRESETS: Final[dict[str, dict[str, float | int]]] = {
    PRESET_CONSERVATIVE: {
        "recent_window_size": 20,
        "baseline_window_size": 60,
        "a1_step_change_threshold": 1.20,
        "a2_win_rate_surge_threshold": 0.20,
        "a3_novel_champion_threshold": 1.20,
        "a3_minimum_novel_games": 8,
        "a4_summoner_level_gate": 45,
        "a4_performance_threshold": 1.20,
        "b1_win_rate_delta_threshold": 0.30,
        "b1_composite_flat_ceiling": 0.05,
        "b2_consistency_shift_threshold": 1.15,
        "b3_bimodality_threshold": 0.65,
        "b3_tail_fraction": 0.30,
        "b4_high_rate_floor": 0.62,
        "b4_drop_threshold": 0.20,
    },
    PRESET_BALANCED: {
        "recent_window_size": 20,
        "baseline_window_size": 40,
        "a1_step_change_threshold": 1.00,
        "a2_win_rate_surge_threshold": 0.15,
        "a3_novel_champion_threshold": 1.00,
        "a3_minimum_novel_games": 5,
        "a4_summoner_level_gate": 60,
        "a4_performance_threshold": 1.00,
        "b1_win_rate_delta_threshold": 0.25,
        "b1_composite_flat_ceiling": 0.10,
        "b2_consistency_shift_threshold": 1.00,
        "b3_bimodality_threshold": 0.60,
        "b3_tail_fraction": 0.25,
        "b4_high_rate_floor": 0.58,
        "b4_drop_threshold": 0.15,
    },
    PRESET_SENSITIVE: {
        "recent_window_size": 15,
        "baseline_window_size": 30,
        "a1_step_change_threshold": 0.80,
        "a2_win_rate_surge_threshold": 0.12,
        "a3_novel_champion_threshold": 0.80,
        "a3_minimum_novel_games": 5,
        "a4_summoner_level_gate": 80,
        "a4_performance_threshold": 0.80,
        "b1_win_rate_delta_threshold": 0.20,
        "b1_composite_flat_ceiling": 0.20,
        "b2_consistency_shift_threshold": 0.85,
        "b3_bimodality_threshold": 0.555,
        "b3_tail_fraction": 0.20,
        "b4_high_rate_floor": 0.55,
        "b4_drop_threshold": 0.12,
    },
}

DEFAULT_PRESET: Final[str] = PRESET_CONSERVATIVE

# Fixed cut points for the B3 tails, in baseline standard deviations.
B3_HIGH_CUT: Final[float] = 1.0
B3_LOW_CUT: Final[float] = -0.5

# Novelty is scoped to what this application has stored.
NOVEL_CHAMPION_MAX_PRIOR_GAMES: Final[int] = 2
