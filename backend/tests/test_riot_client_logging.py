"""Riot client retry and failure logging regressions."""

import asyncio
from typing import Any
from unittest.mock import AsyncMock

import httpx
import pytest
from structlog.testing import capture_logs
from structlog.typing import EventDict

from app.core.riot_api.client import JSONBody, RiotAPIClient
from app.core.riot_api.errors import (
    PuuidDecryptionError,
    RiotAPIError,
    ServiceUnavailableError,
)


def _client() -> RiotAPIClient:
    return RiotAPIClient(api_key="RGAPI-test-only")


def _events(logs: list[EventDict], event_name: str) -> list[EventDict]:
    return [entry for entry in logs if entry.get("event") == event_name]


def _client_serving(statuses: list[int]) -> RiotAPIClient:
    """A client whose transport answers each request with the next status."""
    served = iter(statuses)

    def _handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(next(served), json={"ok": True})

    client = _client()
    client.session = httpx.AsyncClient(transport=httpx.MockTransport(_handler))
    return client


@pytest.fixture
def no_sleep(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _skip(_seconds: float) -> None:
        return None

    monkeypatch.setattr(asyncio, "sleep", _skip)


@pytest.mark.asyncio
@pytest.mark.usefixtures("no_sleep")
async def test_server_error_retry_decision_logs_warning() -> None:
    """A 5xx retry decision is visible with its backoff before the sleep."""
    client = _client_serving([500, 200])

    with capture_logs() as logs:
        result = await client._make_request(
            "https://europe.api.riotgames.com/lol/match/v5/matches/EUN1_1"
        )

    assert result == {"ok": True}
    entries = _events(logs, "riot_api_retrying_server_error")
    assert len(entries) == 1
    assert entries[0]["status_code"] == 500
    assert entries[0]["attempt"] == 0
    assert entries[0]["retry_after"] == 1
    assert entries[0]["log_level"] == "warning"


@pytest.mark.asyncio
@pytest.mark.usefixtures("no_sleep")
@pytest.mark.parametrize(
    ("status_code", "expected_error"),
    [(503, ServiceUnavailableError), (500, RiotAPIError)],
)
async def test_exhausted_server_error_logs_final_failure(
    status_code: int, expected_error: type[Exception]
) -> None:
    """The terminal 5xx raise emits the shared final-failure event so 5xx
    exhaustion is not invisible to riot_api_request_failed consumers."""
    client = _client_serving([status_code] * 4)

    with (
        capture_logs() as logs,
        pytest.raises(expected_error),
    ):
        await client._make_request(
            "https://europe.api.riotgames.com/lol/match/v5/matches/EUN1_1"
        )

    # Three retry decisions precede the terminal failure.
    retries = _events(logs, "riot_api_retrying_server_error")
    assert [entry["attempt"] for entry in retries] == [0, 1, 2]
    failures = _events(logs, "riot_api_request_failed")
    assert len(failures) == 1
    assert failures[0]["status_code"] == status_code
    assert failures[0]["attempts"] == 4
    assert failures[0]["error_type"] == expected_error.__name__
    assert failures[0]["log_level"] == "error"


@pytest.mark.asyncio
async def test_network_retry_logs_one_warning_per_attempt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Every network-error retry is visible before its backoff sleep."""
    client = _client()
    client._execute_single_request = AsyncMock(
        side_effect=httpx.ConnectError("connection refused")
    )

    async def _no_sleep(_seconds: float) -> None:
        return None

    monkeypatch.setattr(asyncio, "sleep", _no_sleep)

    with (
        capture_logs() as logs,
        pytest.raises(RiotAPIError, match="connection refused"),
    ):
        await client._make_request(
            "https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/p/ids"
        )

    retry_entries = _events(logs, "riot_api_network_retry")
    assert [entry["attempt"] for entry in retry_entries] == [0, 1, 2]
    assert {entry["error_type"] for entry in retry_entries} == {"ConnectError"}
    assert retry_entries[0]["endpoint"].startswith("lol/match/v5")

    failure_entries = _events(logs, "riot_api_request_failed")
    assert len(failure_entries) == 1
    assert failure_entries[0]["attempts"] == 4
    assert failure_entries[0]["error_type"] == "ConnectError"
    assert failure_entries[0]["endpoint"].startswith("lol/match/v5")
    assert failure_entries[0]["log_level"] == "error"


def test_puuid_decryption_failure_logs_error_without_message() -> None:
    """The developer-account mismatch is logged without Riot's ciphertext text."""
    client = _client()

    with capture_logs() as logs, pytest.raises(PuuidDecryptionError):
        client._raise_client_error_if_needed(
            400, "Exception decrypting puuid ciphertext"
        )

    entries = _events(logs, "riot_puuid_decryption_failed")
    assert len(entries) == 1
    assert entries[0]["error_type"] == "PuuidDecryptionError"
    assert entries[0]["status_code"] == 400
    # The Riot status message is deliberately not a log field.
    assert "ciphertext" not in str(entries[0])


def test_retry_after_parse_failure_logs_raw_header() -> None:
    """A malformed Retry-After falls back safely at runtime, visibly in logs."""
    client = _client()

    with capture_logs() as logs:
        assert client._parse_retry_after({"retry-after": "tomorrow"}) == 120

    entries = _events(logs, "riot_retry_after_parse_failed")
    assert len(entries) == 1
    assert entries[0]["raw_retry_after"] == "tomorrow"
    assert entries[0]["log_level"] == "debug"


class _BrokenBody:
    """A response stub whose body cannot be decoded as JSON."""

    def json(self) -> Any:
        raise ValueError("not json")


def test_status_message_parse_failure_logs_debug() -> None:
    """A Riot error body that is not JSON still yields a debug breadcrumb."""
    body: JSONBody = _BrokenBody()

    with capture_logs() as logs:
        assert RiotAPIClient._extract_riot_status_message(body) is None

    entries = _events(logs, "riot_status_message_parse_failed")
    assert len(entries) == 1
    assert entries[0]["error_type"] == "ValueError"
    assert entries[0]["log_level"] == "debug"
