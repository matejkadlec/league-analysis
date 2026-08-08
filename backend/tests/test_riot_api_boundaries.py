"""Network-free Riot client boundary tests."""

import json
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError as PydanticValidationError

from app.core.riot_api.client import RiotAPIClient
from app.core.riot_api.constants import QueueType
from app.core.riot_api.errors import (
    AuthenticationError,
    BadRequestError,
    ForbiddenError,
    NotFoundError,
    RateLimitError,
    ServiceUnavailableError,
)

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
    assert client._normalize_queue_type("not-a-queue") is None
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
