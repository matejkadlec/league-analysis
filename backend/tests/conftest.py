"""Fixtures shared by the riot-client suites.

The retry and logging suites both drive the real ``_make_request`` path over an
``httpx.MockTransport``; sharing the builders keeps one stubbing contract.
"""

import asyncio
from collections.abc import Callable, Iterator

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

    Returns the client and the list of statuses actually served. A 429 carries
    real rate-limit headers so exhaustion tests can assert they survive.
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


@pytest.fixture(autouse=True)
def reset_process_wide_state() -> Iterator[None]:
    """Reset every process-global the application keeps, between tests.

    The burst clock, the two run registries and slowapi's limiter are process
    globals, so all four leak across tests -- the limiter across sessions.
    """
    from app.core.http_rate_limit import limiter
    from app.core.riot_api.rate_limiter import RateLimiter
    from app.features.jobs import control
    from app.features.matchmaking_analysis import service

    RateLimiter._last_request_time = 0.0
    limiter.reset()
    yield
    # After, not before: a leaked run would otherwise reach whichever test
    # follows, which under a shuffled order is a different one each run.
    RateLimiter._last_request_time = 0.0
    service._running_analyses.clear()
    control._runtime_controls.clear()
    limiter.reset()
