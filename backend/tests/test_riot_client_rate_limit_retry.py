"""End-to-end 429 handling through `_make_request`.

The retry loop's helpers are pinned elsewhere; what nothing pinned before
this file is the loop itself as callers see it: a 429 answered with
``Retry-After`` waits exactly that long and retries, and exhaustion raises a
``RateLimitError`` still carrying the header evidence. These tests drive the
real request path over an ``httpx.MockTransport`` (built by the shared
``riot_client_answering`` fixture), so they hold no matter what machinery
implements the waiting.
"""

from typing import Any

import pytest
from conftest import RiotClientFactory

from app.core.riot_api.errors import RateLimitError

MATCH_URL = "https://europe.api.riotgames.com/lol/match/v5/matches/EUN1_1"


@pytest.mark.asyncio
async def test_429_waits_the_header_says_and_then_succeeds(
    riot_client_answering: RiotClientFactory, recorded_sleeps: list[float]
) -> None:
    client, served = riot_client_answering([429, 429, 200])

    result: Any = await client._make_request(MATCH_URL)

    assert result == {"ok": True}
    assert served == [429, 429, 200]
    # The wait is Riot's number, not an exponential guess — sending sooner
    # lands in a window the provider has already refused.
    assert recorded_sleeps == [3, 3]


@pytest.mark.asyncio
async def test_429_exhaustion_raises_with_the_header_evidence(
    riot_client_answering: RiotClientFactory, recorded_sleeps: list[float]
) -> None:
    client, served = riot_client_answering([429, 429, 429, 429])

    with pytest.raises(RateLimitError) as error:
        await client._make_request(MATCH_URL)

    # Four attempts total: the initial one plus three retries, each retry
    # preceded by the header's wait.
    assert served == [429, 429, 429, 429]
    assert recorded_sleeps == [3, 3, 3]
    assert error.value.retry_after == 3


@pytest.mark.asyncio
async def test_unretried_request_sends_exactly_once(
    riot_client_answering: RiotClientFactory, recorded_sleeps: list[float]
) -> None:
    # `retry_on_failure=False` exists for credential probes: an expired key
    # must cost one call, not four, against the shared limit.
    client, served = riot_client_answering([429, 200])

    with pytest.raises(RateLimitError):
        await client._make_request(MATCH_URL, retry_on_failure=False)

    assert served == [429]
    assert recorded_sleeps == []
