"""Network-free Riot client boundary tests."""

import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from pydantic import ValidationError as PydanticValidationError

from app.core.riot_api.client import RiotAPIClient
from app.core.riot_api.constants import (
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
    client._make_request = AsyncMock(return_value=LEAGUE_FIXTURES[fixture_name])  # type: ignore[method-assign]

    entries = await client.get_league_entries_by_puuid("sanitized-puuid")

    assert [entry.league_id for entry in entries] == expected_ids
    assert all(entry.queue_type and entry.tier for entry in entries)


@pytest.mark.asyncio
async def test_by_puuid_league_contract_keeps_rank_fields_required() -> None:
    client = RiotAPIClient(api_key="RGAPI-test-only")
    client._make_request = AsyncMock(return_value=LEAGUE_FIXTURES["malformed"])  # type: ignore[method-assign]

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
    kwargs: dict[str, object], message: str
) -> None:
    client = RiotAPIClient(api_key="RGAPI-test-only")
    with pytest.raises(ValueError, match=message):
        await client.get_match_list_by_puuid("sanitized-puuid", **kwargs)  # type: ignore[arg-type]


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
