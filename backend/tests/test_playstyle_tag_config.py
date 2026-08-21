"""What `TAG_CONFIG` has to be true of, that the type checker cannot say.

`TagConfig` pins the spelling and the value type of every key. Three things
it cannot pin, and all three are silent when broken -- a tag whose criteria
never match simply does not appear, and no caller notices:

1. `dict.get` on a TypedDict accepts a key the TypedDict never declared and
   returns `Any | None`, so renaming a key breaks its reader without a single
   type error. Both `target_*` keys were renamed out of one overloaded
   `target`, which is exactly that hazard.
2. Every tag must reach an evaluator. A tag with neither a `type`, a
   per-code evaluator, nor a threshold key falls through to the generic
   comparison and can never fire.
3. `_compare_aggregate_to_thresholds` scans for `min_`/`max_` prefixes and
   compares the value numerically, so a non-numeric value under such a name
   would be skipped rather than raise.
"""

from __future__ import annotations

from app.features.playstyle_analysis.config import TAG_CONFIG
from app.features.playstyle_analysis.evaluators import (
    _CODE_EVALUATORS,
    _TYPE_EVALUATORS,
)

# Keys that select or configure an evaluator rather than serving as a
# threshold the generic comparison reads.
_NON_THRESHOLD_KEYS = frozenset(
    {
        "sentiment",
        "hover_template",
        "display_name",
        "type",
        "check",
        "check_deficit",
        "target_damage_type",
        "target_team",
    }
)


def test_every_tag_reaches_an_evaluator() -> None:
    for tag_code, config in TAG_CONFIG.items():
        tag_type = config.get("type")
        reachable = (
            (tag_type is not None and tag_type in _TYPE_EVALUATORS)
            or tag_code in _CODE_EVALUATORS
            or bool(set(config) - _NON_THRESHOLD_KEYS)
        )
        assert reachable, f"{tag_code} has no evaluator and no threshold to compare"


def test_each_evaluator_type_finds_its_own_arguments() -> None:
    """The keys each shared evaluator reads, on the tags that select it."""
    required_by_type = {
        "damage_type": "target_damage_type",
        "side_preference": "target_team",
        "surrender_check": "check",
    }
    for tag_code, config in TAG_CONFIG.items():
        tag_type = config.get("type", "")
        needed = required_by_type.get(tag_type)
        if needed is not None:
            assert needed in config, f"{tag_code} selects {tag_type} without {needed}"


def test_no_evaluator_type_is_declared_without_an_implementation() -> None:
    declared = {config["type"] for config in TAG_CONFIG.values() if "type" in config}
    assert declared <= set(_TYPE_EVALUATORS)


def test_threshold_keys_hold_numbers() -> None:
    for tag_code, config in TAG_CONFIG.items():
        for key, value in config.items():
            if key.startswith(("min_", "max_")):
                assert isinstance(value, int | float) and not isinstance(value, bool), (
                    f"{tag_code}.{key} is not a number, so it is silently skipped"
                )


def test_the_presentation_keys_every_tag_is_read_for_are_present() -> None:
    """`hover_template` and `display_name` are indexed, not `.get()` with a default."""
    for tag_code, config in TAG_CONFIG.items():
        assert config["hover_template"], f"{tag_code} renders an empty hover"
        assert config["display_name"], f"{tag_code} renders an empty name"
        assert config["sentiment"] in {"positive", "negative", "neutral"}
