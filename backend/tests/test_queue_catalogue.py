"""The queue catalogue knows the queues Riot returns, without syncing them.

MATCH-V5 returned an Arena 3x6 (1750) match id for the tracked reference
player, and the match-list filter refused 1750 before any request because the
catalogue predated it (LGA-120).
"""

import pytest

from app.core.riot_api.client import RiotAPIClient
from app.core.riot_api.constants import PRODUCT_SUPPORTED_QUEUE_IDS, QueueType

# Owner decision 2026-11-16: catalogued for reading, never synced.
NEW_CATALOGUED = (710, 1740, 1750)
ARENA_QUEUES = (1700, 1710, 1740, 1750)
ARAM_MAYHEM_VARIANT = 2450


@pytest.mark.parametrize("queue_id", [*NEW_CATALOGUED, ARAM_MAYHEM_VARIANT])
def test_a_queue_riot_returns_today_is_a_valid_match_list_filter(
    queue_id: int,
) -> None:
    client = RiotAPIClient(api_key="RGAPI-test-only")

    assert client._normalize_queue_type(str(queue_id)) == QueueType(queue_id)


def test_ranked_5s_and_arena_are_catalogued_but_not_synced() -> None:
    """Arena has no 5v5 teams, so syncing it needs design work, not an id."""
    for queue_id in (710, *ARENA_QUEUES):
        assert queue_id in {queue.value for queue in QueueType}
        assert queue_id not in PRODUCT_SUPPORTED_QUEUE_IDS


def test_the_mayhem_variant_waits_for_riot_to_expose_mayhem() -> None:
    """2450 follows LGA-121's rule: it joins only once MATCH-V5 returns Mayhem."""
    assert QueueType(ARAM_MAYHEM_VARIANT)
    assert ARAM_MAYHEM_VARIANT not in PRODUCT_SUPPORTED_QUEUE_IDS
