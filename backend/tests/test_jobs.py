"""Background-job configuration and error-boundary tests."""

import pytest

from app.core.riot_api.errors import AuthenticationError, RateLimitError
from app.features.jobs.error_handling import RateLimitSignal, handle_riot_api_errors
from app.features.jobs.queue_config import (
    MATCH_FETCHER_DEFAULT_QUEUE_IDS,
    get_enabled_match_fetcher_queue_ids,
    has_enabled_match_fetcher_queue,
    normalize_match_fetcher_config,
)


def test_queue_configuration_defaults_and_preserves_known_order() -> None:
    assert get_enabled_match_fetcher_queue_ids(None) == MATCH_FETCHER_DEFAULT_QUEUE_IDS
    assert get_enabled_match_fetcher_queue_ids({"enabled_queue_ids": []}) == []
    assert get_enabled_match_fetcher_queue_ids(
        {"enabled_queue_ids": [450, "420", 999, 420]}
    ) == [420, 450]
    assert normalize_match_fetcher_config({"other": "value"}) == {
        "other": "value",
        "enabled_queue_ids": MATCH_FETCHER_DEFAULT_QUEUE_IDS,
    }
    assert not has_enabled_match_fetcher_queue({"enabled_queue_ids": []})


@pytest.mark.asyncio
async def test_rate_limit_is_converted_to_job_signal() -> None:
    @handle_riot_api_errors(operation="fetch matches")
    async def failing_job() -> None:
        raise RateLimitError("limited", status_code=429, retry_after=7)

    with pytest.raises(RateLimitSignal) as error:
        await failing_job()
    assert error.value.retry_after == 7


@pytest.mark.asyncio
async def test_authentication_errors_remain_fatal() -> None:
    @handle_riot_api_errors(operation="fetch player", critical=False)
    async def failing_job() -> None:
        raise AuthenticationError("expired", status_code=401)

    with pytest.raises(AuthenticationError):
        await failing_job()


@pytest.mark.asyncio
async def test_noncritical_job_error_returns_none() -> None:
    @handle_riot_api_errors(operation="optional lookup", critical=False)
    async def failing_job() -> None:
        raise RuntimeError("fixture failure")

    assert await failing_job() is None
