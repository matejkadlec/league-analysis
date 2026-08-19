"""Fixtures shared by the riot-client suites.

The retry and logging files both drive the real ``_make_request`` path over
an ``httpx.MockTransport``. The client builder and the sleep recorder live
here once, so a change to client stubbing or to the sleep-observation
contract lands in every suite at the same time instead of leaving one of
them silently testing stale wiring.
"""

import asyncio
from collections.abc import Callable

import httpx
import pytest

from app.core.riot_api.client import RiotAPIClient

_RATE_LIMIT_HEADERS = {
    "Retry-After": "3",
    "X-App-Rate-Limit": "20:1,100:120",
    "X-Method-Rate-Limit": "2000:10",
}

RiotClientFactory = Callable[[list[int]], tuple[RiotAPIClient, list[int]]]


@pytest.fixture
def riot_client_answering() -> RiotClientFactory:
    """A client whose transport answers each request with the next status.

    Returns the client and the list of statuses actually served. A 429 comes
    with real rate-limit headers, so exhaustion tests can assert the header
    evidence survives to the raised error.
    """

    def _build(statuses: list[int]) -> tuple[RiotAPIClient, list[int]]:
        served: list[int] = []

        def _handler(_request: httpx.Request) -> httpx.Response:
            status = statuses[len(served)]
            served.append(status)
            if status == 429:
                return httpx.Response(429, headers=_RATE_LIMIT_HEADERS)
            return httpx.Response(status, json={"ok": True})

        client = RiotAPIClient(api_key="RGAPI-test-only")
        client.session = httpx.AsyncClient(transport=httpx.MockTransport(_handler))
        return client, served

    return _build


@pytest.fixture
def recorded_sleeps(monkeypatch: pytest.MonkeyPatch) -> list[float]:
    """Record every wait the retry loop asks for instead of sleeping it out."""
    sleeps: list[float] = []

    async def _record(seconds: float) -> None:
        sleeps.append(seconds)

    monkeypatch.setattr(asyncio, "sleep", _record)
    return sleeps
