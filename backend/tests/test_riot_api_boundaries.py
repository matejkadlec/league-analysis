"""Network-free Riot client boundary tests."""

import json
from pathlib import Path
from typing import TypedDict
from unittest.mock import AsyncMock, patch

import pytest
from pydantic import ValidationError as PydanticValidationError

from app.core.riot_api.client import RiotAPIClient
from app.core.riot_api.constants import (
    PRODUCT_SUPPORTED_QUEUE_IDS,
    MatchType,
    Platform,
    QueueType,
    Region,
    get_region_by_platform,
)
from app.core.riot_api.endpoints import RiotAPIEndpoints
from app.core.riot_api.errors import (
    AuthenticationError,
    BadRequestError,
    ForbiddenError,
    NotFoundError,
    RateLimitError,
    ServiceUnavailableError,
)
from app.core.riot_api.rate_limiter import RateLimiter

LEAGUE_FIXTURES = json.loads(
    (Path(__file__).parent / "fixtures" / "league_entries_by_puuid.json").read_text()
)


class MatchListKwargs(TypedDict, total=False):
    """The subset of `get_match_list_by_puuid` keywords the bounds cases vary.

    Values here are all accepted by the signature; the rejection is a runtime
    bounds check, not a typing one.
    """

    start: int
    count: int
    queue: int | str | QueueType
    type: str | MatchType
    start_time: int
    end_time: int


def test_client_requires_explicit_api_key() -> None:
    with pytest.raises(ValueError, match="api_key is required"):
        RiotAPIClient()


@pytest.mark.parametrize(
    ("status_code", "exception_type"),
    [
        (400, BadRequestError),
        (401, AuthenticationError),
        (403, ForbiddenError),
        (404, NotFoundError),
    ],
)
def test_client_maps_non_retryable_statuses(
    status_code: int, exception_type: type[Exception]
) -> None:
    client = RiotAPIClient(api_key="RGAPI-test-only")
    with pytest.raises(exception_type):
        client._raise_client_error_if_needed(status_code)


def test_retry_after_and_rate_limit_use_safe_bounds() -> None:
    client = RiotAPIClient(api_key="RGAPI-test-only")
    assert client._parse_retry_after({}) == 120
    assert client._parse_retry_after({"retry-after": "invalid"}) == 120
    assert client._parse_retry_after({"retry-after": "0"}) == 1
    assert client._handle_rate_limit({"retry-after": "3"}, 0, 1) == (True, 3)

    with pytest.raises(RateLimitError) as error:
        client._handle_rate_limit({"retry-after": "3"}, 1, 1)
    assert error.value.retry_after == 3


def test_server_retry_boundary_and_queue_normalization() -> None:
    client = RiotAPIClient(api_key="RGAPI-test-only")
    assert client._handle_server_error(500, 0, 1) == (True, 1)
    with pytest.raises(ServiceUnavailableError):
        client._handle_server_error(503, 1, 1)

    assert client._normalize_queue_type("420") is QueueType.RANKED_SOLO_5X5
    with pytest.raises(ValueError, match="Unsupported Riot queue"):
        client._normalize_queue_type("not-a-queue")
    assert client._extract_endpoint_path("https://europe.api.riotgames.com/path") == (
        "path"
    )


def test_product_supported_queue_catalog_is_explicit_and_complete() -> None:
    assert PRODUCT_SUPPORTED_QUEUE_IDS == (420, 440, 480, 400, 450, 2400)
    assert QueueType(480) is QueueType.SWIFTPLAY
    assert QueueType(2400) is QueueType.ARAM_MAYHEM
    assert 999999 not in PRODUCT_SUPPORTED_QUEUE_IDS


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("fixture_name", "expected_ids"),
    [
        ("present", ["sanitized-league-id"]),
        ("missing", [None]),
        ("mixed", ["sanitized-solo-league-id", None]),
        ("empty", []),
    ],
)
async def test_by_puuid_league_contract_preserves_optional_league_id(
    fixture_name: str,
    expected_ids: list[str | None],
) -> None:
    client = RiotAPIClient(api_key="RGAPI-test-only")
    client._make_request = AsyncMock(return_value=LEAGUE_FIXTURES[fixture_name])

    entries = await client.get_league_entries_by_puuid("sanitized-puuid")

    assert [entry.league_id for entry in entries] == expected_ids
    assert all(entry.queue_type and entry.tier for entry in entries)


@pytest.mark.asyncio
async def test_by_puuid_league_contract_keeps_rank_fields_required() -> None:
    client = RiotAPIClient(api_key="RGAPI-test-only")
    client._make_request = AsyncMock(return_value=LEAGUE_FIXTURES["malformed"])

    with pytest.raises(PydanticValidationError) as error:
        await client.get_league_entries_by_puuid("sanitized-puuid")

    assert error.value.errors()[0]["loc"] == ("queueType",)


def test_platform_mapping_and_endpoint_parameters_fail_closed() -> None:
    assert get_region_by_platform(Platform.EUN1) is Region.EUROPE
    assert get_region_by_platform("oc1") is Region.SEA
    with pytest.raises(ValueError, match="Unsupported Riot platform"):
        get_region_by_platform("made-up")

    endpoints = RiotAPIEndpoints()
    url = endpoints.match_list_by_puuid(
        "safe/value",
        start=0,
        count=100,
        queue=QueueType.RANKED_SOLO_5X5,
        type=MatchType.RANKED,
        start_time=0,
        end_time=1,
    )
    assert "/safe%2Fvalue/ids?" in url
    assert "queue=420" in url
    assert "type=ranked" in url
    assert "startTime=0" in url


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"start": -1}, "start must"),
        ({"count": 101}, "count must"),
        ({"queue": 999999}, "Unsupported Riot queue"),
        ({"type": "invalid"}, "Unsupported Riot match type"),
        ({"start_time": 2, "end_time": 1}, "start_time must"),
    ],
)
async def test_match_list_rejects_invalid_provider_parameters(
    kwargs: MatchListKwargs, message: str
) -> None:
    client = RiotAPIClient(api_key="RGAPI-test-only")
    with pytest.raises(ValueError, match=message):
        await client.get_match_list_by_puuid("sanitized-puuid", **kwargs)


def test_adaptive_rate_windows_keep_original_reset_and_routing_scope() -> None:
    limiter = RateLimiter()
    headers = {
        "X-App-Rate-Limit": "2:1,100:120",
        "X-App-Rate-Limit-Count": "1:1,10:120",
        "X-Method-Rate-Limit": "1:10",
        "X-Method-Rate-Limit-Count": "1:10",
    }
    europe = "https://europe.api.riotgames.com/lol/match/v5/matches/id"
    americas = "https://americas.api.riotgames.com/lol/match/v5/matches/id"

    with patch("app.core.riot_api.rate_limiter.time.monotonic", return_value=10.0):
        limiter.update_limits(headers, europe)
    original = dict(limiter._app_windows)
    with patch("app.core.riot_api.rate_limiter.time.monotonic", return_value=10.5):
        limiter.update_limits(headers, europe)
        limiter.update_limits(headers, americas)

    assert limiter._app_windows[("europe.api.riotgames.com", 1)].started_at == 10.0
    assert limiter._app_windows[("europe.api.riotgames.com", 120)].started_at == 10.0
    assert limiter._app_windows[("americas.api.riotgames.com", 1)].started_at == 10.5
    assert len(original) == 2


def test_method_rate_scope_normalizes_ids_but_keeps_routes_distinct() -> None:
    limiter = RateLimiter()
    detail_one = limiter._get_endpoint_key(
        "https://europe.api.riotgames.com/lol/match/v5/matches/EUN1_1", "GET"
    )
    detail_two = limiter._get_endpoint_key(
        "https://europe.api.riotgames.com/lol/match/v5/matches/EUN1_2", "GET"
    )
    timeline = limiter._get_endpoint_key(
        "https://europe.api.riotgames.com/lol/match/v5/matches/EUN1_1/timeline",
        "GET",
    )
    match_list = limiter._get_endpoint_key(
        "https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/safe/ids",
        "GET",
    )

    assert detail_one == detail_two
    assert len({detail_one, timeline, match_list}) == 3


RATE_LIMITER_CLOCK = "app.core.riot_api.rate_limiter.time.monotonic"
RATE_LIMITER_SLEEP = "app.core.riot_api.rate_limiter.asyncio.sleep"

MATCH_DETAIL_ENDPOINT = "https://europe.api.riotgames.com/lol/match/v5/matches/EUN1_1"


def _app_window_headers(limit: str, count: str) -> dict[str, str]:
    """Return the header pair Riot sends for one application window."""
    return {"X-App-Rate-Limit": limit, "X-App-Rate-Limit-Count": count}


async def test_saturated_window_waits_out_the_provider_interval() -> None:
    """A used-up window must hold the next request until the window resets.

    This is the entire point of the limiter and nothing was exercising it.
    Without the wait the client sends straight into a window Riot has already
    filled, and the provider answers 429s and escalates a persistent offender
    to a key ban -- which on this deployment takes ingestion down completely,
    because there is one key.
    """
    limiter = RateLimiter()
    with patch(RATE_LIMITER_CLOCK, return_value=100.0):
        limiter.update_limits(
            _app_window_headers("20:1", "20:1"), MATCH_DETAIL_ENDPOINT
        )

    slept: list[float] = []

    async def record(seconds: float) -> None:
        slept.append(seconds)

    with (
        patch(RATE_LIMITER_CLOCK, return_value=100.4),
        patch(RATE_LIMITER_SLEEP, side_effect=record),
    ):
        await limiter.wait_if_needed(MATCH_DETAIL_ENDPOINT)

    assert slept == [pytest.approx(0.6)]


async def test_consecutive_requests_keep_the_burst_spacing() -> None:
    """Back-to-back calls are spaced even when no window is near its limit.

    The provider counts a burst against a window that has not been observed
    yet, so the spacing is what keeps a fresh limiter from opening with a
    salvo. Two calls in the same hundredth of a second must be held apart.
    """
    limiter = RateLimiter()
    slept: list[float] = []

    async def record(seconds: float) -> None:
        slept.append(seconds)

    with (
        patch(
            RATE_LIMITER_CLOCK,
            side_effect=[1000.0, 1000.0, 1000.01, 1000.01],
        ),
        patch(RATE_LIMITER_SLEEP, side_effect=record),
    ):
        await limiter.wait_if_needed(MATCH_DETAIL_ENDPOINT)
        await limiter.wait_if_needed(MATCH_DETAIL_ENDPOINT)

    assert slept == [pytest.approx(limiter.request_spacing - 0.01)]


def test_a_count_that_dropped_means_a_new_window_began() -> None:
    """A lower count is the only signal that the provider window rolled over.

    Riot does not say when a window started; the limiter infers it from the
    first observation. If a count goes down, the window it belonged to is
    gone and a new one is running -- so its deadline has to move with it.
    Anchoring to the old start makes the limiter believe capacity returns
    sooner than it does, and it resumes sending into a window that is still
    filling.
    """
    limiter = RateLimiter()
    scope = ("europe.api.riotgames.com", 120)

    with patch(RATE_LIMITER_CLOCK, return_value=200.0):
        limiter.update_limits(
            _app_window_headers("100:120", "90:120"), MATCH_DETAIL_ENDPOINT
        )
    with patch(RATE_LIMITER_CLOCK, return_value=260.0):
        limiter.update_limits(
            _app_window_headers("100:120", "5:120"), MATCH_DETAIL_ENDPOINT
        )

    assert limiter._app_windows[scope].started_at == 260.0


async def test_elapsed_windows_are_dropped_rather_than_carried() -> None:
    """Windows whose interval has passed are removed, not merely ignored.

    The match fetcher holds one limiter for hours across many endpoints, so a
    window that is only skipped instead of deleted stays in the dictionary for
    the life of the process, once per scope it ever saw.
    """
    limiter = RateLimiter()
    with patch(RATE_LIMITER_CLOCK, return_value=300.0):
        limiter.update_limits(
            _app_window_headers("10:1", "10:1"), MATCH_DETAIL_ENDPOINT
        )
    assert limiter._app_windows

    slept: list[float] = []

    async def record(seconds: float) -> None:
        slept.append(seconds)

    with (
        patch(RATE_LIMITER_CLOCK, return_value=305.0),
        patch(RATE_LIMITER_SLEEP, side_effect=record),
    ):
        await limiter.wait_if_needed(MATCH_DETAIL_ENDPOINT)

    assert slept == []
    assert limiter._app_windows == {}


def test_riot_id_lookups_share_one_method_window() -> None:
    """Both segments of a Riot ID are redacted, so all lookups share a scope.

    A Riot ID is two path segments, `gameName/tagLine`. Redact fewer and every
    player searched for becomes its own method window: each one looks unused,
    the shared method budget is never observed, and the limiter waits for a
    limit it cannot see.
    """
    limiter = RateLimiter()
    base = "https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id"

    assert limiter._get_endpoint_key(
        f"{base}/PlayerOne/EUW", "GET"
    ) == limiter._get_endpoint_key(f"{base}/PlayerTwo/EUN1", "GET")


def test_unreadable_rate_headers_do_not_break_the_request() -> None:
    """A header the parser cannot read degrades to no window, not an exception.

    `update_limits` is called on the success path of every Riot response. If a
    provider-side format change raised here, it would fail requests that had
    already succeeded -- the limiter is advisory, and losing it must not lose
    the data.
    """
    limiter = RateLimiter()

    limiter.update_limits({1: "2:1"}, MATCH_DETAIL_ENDPOINT)  # type: ignore[dict-item]

    assert limiter._app_windows == {}
