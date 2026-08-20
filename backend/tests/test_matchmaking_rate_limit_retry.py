"""How one Riot call behaves under rate limiting, per outcome.

`_api_call_with_retries` is the whole of this analysis's rate-limit posture --
how long it waits, how many times, what it tells the client while waiting, and
whether exhaustion is a failure or a shrug. None of it had a test, so any
change to the loop was unfalsifiable.
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.riot_api.errors import (
    AuthenticationError,
    ForbiddenError,
    NotFoundError,
    RateLimitError,
)
from app.features.matchmaking_analysis import service as service_module
from app.features.matchmaking_analysis.service import (
    MAX_RATE_LIMIT_WAIT,
    MatchmakingAnalysisRuntimeError,
    MatchmakingAnalysisService,
)


@pytest.fixture
def slept(monkeypatch: pytest.MonkeyPatch) -> list[float]:
    """Capture every sleep instead of taking it."""
    taken: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        taken.append(seconds)

    monkeypatch.setattr(service_module.asyncio, "sleep", fake_sleep)
    return taken


def _service() -> tuple[MatchmakingAnalysisService, AsyncMock]:
    """A service plus the mock standing in for its rate-limit lifecycle write.

    The row that write touches is covered elsewhere; what matters here is when
    a reset time is published and when it is cleared.
    """
    svc = MatchmakingAnalysisService(MagicMock(), MagicMock())
    reset = AsyncMock()
    svc._set_rate_limit_reset = reset
    return svc, reset


def _raises(*errors: Exception) -> Any:
    """A fetch that raises each error in turn, then succeeds."""
    remaining = list(errors)

    async def fetch() -> str:
        if remaining:
            raise remaining.pop(0)
        return "ok"

    return fetch


@pytest.mark.asyncio
async def test_a_call_that_works_is_recorded_and_returned(slept: list[float]) -> None:
    svc, _ = _service()

    result = await svc._api_call_with_retries(
        _raises(), required=False, operation="probe"
    )

    assert result == "ok"
    assert svc.api_calls_made == 1
    assert slept == []


@pytest.mark.asyncio
async def test_rate_limit_waits_the_servers_own_retry_after_then_succeeds(
    slept: list[float],
) -> None:
    svc, _ = _service()

    result = await svc._api_call_with_retries(
        _raises(RateLimitError("slow down", retry_after=30)),
        required=False,
        operation="probe",
    )

    assert result == "ok"
    assert slept == [30]
    assert svc.api_calls_made == 1


@pytest.mark.asyncio
async def test_a_rate_limit_without_a_retry_after_waits_two_minutes(
    slept: list[float],
) -> None:
    svc, _ = _service()

    await svc._api_call_with_retries(
        _raises(RateLimitError("slow down", retry_after=None)),
        required=False,
        operation="probe",
    )

    assert slept == [120]


@pytest.mark.asyncio
async def test_an_absurd_retry_after_is_clamped(slept: list[float]) -> None:
    """Riot can ask for an hour. Waiting it would stall the whole analysis."""
    svc, _ = _service()

    await svc._api_call_with_retries(
        _raises(RateLimitError("slow down", retry_after=3600)),
        required=False,
        operation="probe",
    )

    assert slept == [MAX_RATE_LIMIT_WAIT]


@pytest.mark.asyncio
async def test_the_client_is_told_it_is_waiting_and_told_when_it_stops(
    slept: list[float],
) -> None:
    """The persisted reset time is what renders as `waiting_rate_limit`."""
    svc, reset = _service()

    await svc._api_call_with_retries(
        _raises(RateLimitError("slow down", retry_after=30)),
        required=False,
        operation="probe",
    )

    writes = reset.await_args_list
    assert len(writes) == 2
    assert writes[0].args[0] is not None, "a reset time is published before sleeping"
    assert writes[1].args[0] is None, "and cleared once the call goes through"
    assert svc._is_waiting_for_rate_limit is False


@pytest.mark.asyncio
async def test_ten_rate_limits_exhaust_the_budget_and_answer_nothing(
    slept: list[float],
) -> None:
    svc, _ = _service()
    limits = [RateLimitError("slow down", retry_after=5) for _ in range(20)]

    result = await svc._api_call_with_retries(
        _raises(*limits), required=False, operation="probe"
    )

    assert result is None
    # Nine waits, not ten: there is nothing to wait *for* after the last
    # attempt. The hand-rolled loop slept once more and then gave up anyway,
    # burning up to MAX_RATE_LIMIT_WAIT seconds to reach the same answer.
    assert len(slept) == svc.MAX_RATE_LIMIT_ATTEMPTS - 1
    assert svc.api_calls_made == 0


@pytest.mark.asyncio
async def test_exhaustion_on_a_required_call_is_a_named_failure(
    slept: list[float],
) -> None:
    """A required call cannot degrade: the analysis has to say why it stopped."""
    svc, _ = _service()
    limits = [RateLimitError("slow down", retry_after=5) for _ in range(20)]

    with pytest.raises(MatchmakingAnalysisRuntimeError) as caught:
        await svc._api_call_with_retries(
            _raises(*limits), required=True, operation="probe"
        )

    assert caught.value.code == "rate_limit_wait_exhausted"


@pytest.mark.asyncio
async def test_an_ordinary_riot_failure_is_not_retried(slept: list[float]) -> None:
    """Only rate limits are worth waiting out; a 404 will still be a 404."""
    svc, _ = _service()
    fetch = _raises(NotFoundError("no such match"))

    result = await svc._api_call_with_retries(fetch, required=False, operation="probe")

    assert result is None
    assert slept == []


@pytest.mark.parametrize(
    "error",
    [AuthenticationError("bad key"), ForbiddenError("no")],
    ids=["authentication", "forbidden"],
)
@pytest.mark.asyncio
async def test_a_credential_failure_always_escapes(
    error: Exception, slept: list[float]
) -> None:
    """Grinding the rest of the analysis against a rejected key helps nobody."""
    svc, _ = _service()

    with pytest.raises(type(error)):
        await svc._api_call_with_retries(
            _raises(error), required=False, operation="probe"
        )


@pytest.mark.asyncio
async def test_a_required_call_reraises_even_an_ordinary_failure(
    slept: list[float],
) -> None:
    svc, _ = _service()

    with pytest.raises(NotFoundError):
        await svc._api_call_with_retries(
            _raises(NotFoundError("no such match")), required=True, operation="probe"
        )


@pytest.mark.asyncio
async def test_exhaustion_does_not_leave_the_client_told_it_is_still_waiting(
    slept: list[float],
) -> None:
    """After giving up, nothing is waiting -- so nothing should say it is.

    The persisted reset time drives the `waiting_rate_limit` state the page
    renders. Left set after the analysis has stopped, it shows a countdown for
    work that will never resume.
    """
    svc, reset = _service()
    limits = [RateLimitError("slow down", retry_after=5) for _ in range(20)]

    result = await svc._api_call_with_retries(
        _raises(*limits), required=False, operation="probe"
    )

    assert result is None
    last_write = reset.await_args_list[-1]
    assert last_write.args[0] is None, (
        "the last thing written should clear the wait, not publish another one"
    )
    assert svc._is_waiting_for_rate_limit is False
