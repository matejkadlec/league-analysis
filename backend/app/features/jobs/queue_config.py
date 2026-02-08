"""Utilities for Match Fetcher queue configuration stored in config_json."""

from typing import Any

# Queue IDs supported by Match Fetcher queue toggles
MATCH_FETCHER_QUEUE_IDS: tuple[int, ...] = (420, 440, 400, 450)

# Queue IDs shown in the same order in UI
MATCH_FETCHER_QUEUE_ORDER: tuple[int, ...] = (420, 440, 400, 450)

# Default: all supported queues enabled
MATCH_FETCHER_DEFAULT_QUEUE_IDS: list[int] = [420, 440, 400, 450]

MATCH_FETCHER_ENABLED_QUEUE_IDS_KEY = "enabled_queue_ids"


def normalize_match_fetcher_config(config_json: dict[str, Any] | None) -> dict[str, Any]:
    """Normalize Match Fetcher config_json with safe queue defaults.

    Returns a copy with a guaranteed `enabled_queue_ids` key.
    """
    config = dict(config_json or {})
    config[MATCH_FETCHER_ENABLED_QUEUE_IDS_KEY] = _normalize_enabled_queue_ids(
        config.get(MATCH_FETCHER_ENABLED_QUEUE_IDS_KEY)
    )
    return config


def get_enabled_match_fetcher_queue_ids(
    config_json: dict[str, Any] | None,
) -> list[int]:
    """Extract enabled queue IDs from Match Fetcher config_json."""
    normalized = normalize_match_fetcher_config(config_json)
    return list(normalized[MATCH_FETCHER_ENABLED_QUEUE_IDS_KEY])


def has_enabled_match_fetcher_queue(config_json: dict[str, Any] | None) -> bool:
    """Whether at least one queue is enabled in Match Fetcher config_json."""
    return len(get_enabled_match_fetcher_queue_ids(config_json)) > 0


def _normalize_enabled_queue_ids(raw_queue_ids: Any) -> list[int]:
    """Normalize `enabled_queue_ids` while preserving known queue order.

    Rules:
    - missing/invalid value => all queues enabled (safe default)
    - empty list => no queues enabled
    - invalid values inside a non-empty list are ignored
    - if non-empty list has no valid values => all queues enabled
    """
    if raw_queue_ids is None:
        return list(MATCH_FETCHER_DEFAULT_QUEUE_IDS)

    if not isinstance(raw_queue_ids, list):
        return list(MATCH_FETCHER_DEFAULT_QUEUE_IDS)

    if len(raw_queue_ids) == 0:
        return []

    normalized_values: set[int] = set()
    for raw_value in raw_queue_ids:
        try:
            queue_id = int(raw_value)
        except (TypeError, ValueError):
            continue

        if queue_id in MATCH_FETCHER_QUEUE_IDS:
            normalized_values.add(queue_id)

    if not normalized_values:
        return list(MATCH_FETCHER_DEFAULT_QUEUE_IDS)

    return [queue_id for queue_id in MATCH_FETCHER_QUEUE_ORDER if queue_id in normalized_values]
