"""Match Fetcher access to the canonical product-supported queue set."""

from typing import Any

from app.core.riot_api.constants import PRODUCT_SUPPORTED_QUEUE_IDS

# Product support is declared once at the Riot boundary. Match Fetcher always
# uses this complete tuple and never narrows it with persisted configuration.
MATCH_FETCHER_QUEUE_IDS: tuple[int, ...] = PRODUCT_SUPPORTED_QUEUE_IDS
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


def get_match_fetcher_queue_ids() -> list[int]:
    """Return every product-supported queue in deterministic canonical order."""
    return list(MATCH_FETCHER_QUEUE_IDS)
