"""The queue catalogue knows the queues Riot returns, without syncing them.

MATCH-V5 returned an Arena 3x6 (1750) match id for the tracked reference
player, and the match-list filter refused 1750 before any request because the
catalogue predated it (LGA-120).
"""

import json
from pathlib import Path

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


# Riot's official queue list, as served by
# static.developer.riotgames.com/docs/lol/queues.json on 2026-11-23.
RIOT_QUEUES = Path(__file__).parent / "fixtures" / "riot_queues_2026_11_23.json"

# Queues Riot lists without marking them deprecated that the catalogue leaves
# out: custom games have no queue, TFT is not a League match, and the rest are
# rotating modes retired long before MATCH-V5's history reaches.
NOT_CATALOGUED = {
    0: "custom games",
    **dict.fromkeys((1090, 1100, 1110, 1111, 1210), "Teamfight Tactics"),
    **dict.fromkeys(
        (72, 73, 75, 76, 78, 83, 98, 100, 310, 313, 317, 325),
        "retired rotating mode",
    ),
}

# Live queues Riot's list does not name yet: MATCH-V5 returned 1750, and the
# others are in Riot's client data (LGA-120).
LIVE_ONLY = {710, 1740, 1750, 2450}


def _riot_queues() -> list[dict[str, object]]:
    return json.loads(RIOT_QUEUES.read_text(encoding="utf-8"))


def _is_deprecated(queue: dict[str, object]) -> bool:
    return "deprecated" in str(queue.get("notes") or "").lower()


def test_every_queue_riot_lists_is_catalogued_or_left_out_on_purpose() -> None:
    """A refreshed copy that gains a queue fails here until someone decides."""
    catalogue = {queue.value for queue in QueueType}
    undecided = [
        (queue["queueId"], queue["description"])
        for queue in _riot_queues()
        if not _is_deprecated(queue)
        and queue["queueId"] not in catalogue
        and queue["queueId"] not in NOT_CATALOGUED
    ]

    assert undecided == []


def test_every_catalogued_queue_comes_from_riot() -> None:
    riot_ids = {queue["queueId"] for queue in _riot_queues()}

    unsourced = [
        queue.value
        for queue in QueueType
        if queue.value not in riot_ids and queue.value not in LIVE_ONLY
    ]

    assert unsourced == []


def test_the_left_out_queues_are_still_ones_riot_lists() -> None:
    """An exclusion Riot has since dropped or deprecated is dead weight."""
    listed = {queue["queueId"] for queue in _riot_queues() if not _is_deprecated(queue)}

    assert set(NOT_CATALOGUED) <= listed
    assert not LIVE_ONLY & {queue["queueId"] for queue in _riot_queues()}
