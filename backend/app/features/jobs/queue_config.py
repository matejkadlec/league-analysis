"""Match Fetcher config normalization for the obsolete per-queue selection."""

from typing import Any

LEGACY_MATCH_FETCHER_ENABLED_QUEUE_IDS_KEY = "enabled_queue_ids"


def normalize_match_fetcher_config(
    config_json: dict[str, Any] | None,
) -> dict[str, Any]:
    """Remove the obsolete per-queue selection from Match Fetcher config.

    Historical rows can retain ``enabled_queue_ids`` until their next ordinary
    configuration update. Runtime behavior and API responses ignore the field,
    so stale values can never restrict the canonical supported queue set.
    """
    config = dict(config_json or {})
    config.pop(LEGACY_MATCH_FETCHER_ENABLED_QUEUE_IDS_KEY, None)
    return config
