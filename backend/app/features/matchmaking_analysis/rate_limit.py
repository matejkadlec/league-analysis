"""The rate-limit wait and retry policy one analysis run's Riot calls use.

`_api_call_with_retries` is the whole posture: wait budget, attempt count,
client status while waiting, and whether exhaustion is a failure. The service
composes the mixin; `_RetryPolicyHost` declares the plumbing it leans on.
"""

import asyncio
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

import structlog
from sqlalchemy import ColumnElement, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db_session import rollback_quietly
from app.core.riot_api.errors import (
    AuthenticationError,
    ForbiddenError,
    RateLimitError,
    RiotAPIError,
)

from .errors import MatchmakingAnalysisRuntimeError
from .models import MatchmakingAnalysis

logger = structlog.get_logger(__name__)

MAX_RATE_LIMIT_WAIT = 120

# The retry policy `_api_call_with_retries` runs under, as plain rules --
# none of it reads run state.


def _rate_limit_retry_after(error: RateLimitError) -> int:
    return int(error.retry_after or 120)


def _should_reraise_riot_error(error: RiotAPIError, *, required: bool) -> bool:
    return isinstance(error, (AuthenticationError, ForbiddenError)) or required


def _raise_if_retries_exhausted(*, required: bool) -> None:
    if required:
        raise MatchmakingAnalysisRuntimeError(
            "rate_limit_wait_exhausted",
            "The analysis could not resume within the allowed Riot rate-limit "
            "wait. Please try again later.",
        )


class _RetryPolicyHost(Protocol):
    """The run-row surface the policy needs from its composing service."""

    db: AsyncSession
    requests_saved: int
    api_calls_made: int
    _is_waiting_for_rate_limit: bool
    _current_analysis_puuid: str | None
    _current_analysis_created_at: datetime | None

    def _active_run_where(
        self, puuid: str, created_at: datetime
    ) -> ColumnElement[bool]:
        """The WHERE clause naming the run being written; provided by the
        composing service."""
        ...

    async def _write_active_run(
        self, puuid: str, created_at: datetime, **values: Any
    ) -> None:
        """The guarded, committed UPDATE of that run; provided by the
        composing service."""
        ...


class RateLimitRetryMixin(_RetryPolicyHost):
    """The shared rate-limit retry policy, composed onto the service."""

    MAX_RATE_LIMIT_ATTEMPTS = 10

    async def _api_call_with_retries[T](
        self,
        fetch: Callable[[], Awaitable[T]],
        *,
        required: bool,
        operation: str,
        **log_fields: object,
    ) -> T | None:
        """Run one Riot call under the shared rate-limit retry policy.

        Returns None when capacity is unavailable, the error is recoverable,
        or retries are exhausted; `required=True` raises instead. These attempts
        stack on the Riot client's own tenacity retry of 429/5xx.
        """
        for attempt in range(self.MAX_RATE_LIMIT_ATTEMPTS):
            try:
                result = await fetch()
                await self._record_successful_api_call()
                return result

            except RateLimitError as e:
                retry_after = _rate_limit_retry_after(e)
                logger.info(
                    "Rate limit during Riot call",
                    operation=operation,
                    retry_after=retry_after,
                    attempt=attempt + 1,
                    **log_fields,
                )
                if attempt + 1 == self.MAX_RATE_LIMIT_ATTEMPTS:
                    break
                await self._wait_for_rate_limit(retry_after)

            except RiotAPIError as e:
                logger.warning(
                    "Riot call failed",
                    operation=operation,
                    error_type=type(e).__name__,
                    **log_fields,
                )
                if _should_reraise_riot_error(e, required=required):
                    raise
                return None

        logger.warning("Riot call retries exhausted", operation=operation, **log_fields)
        await self._clear_rate_limit_wait_if_active()
        _raise_if_retries_exhausted(required=required)
        return None

    async def _record_successful_api_call(self) -> None:
        self.api_calls_made += 1
        await self._clear_rate_limit_wait_if_active()

    async def _wait_for_rate_limit(self, retry_after: int) -> None:
        """Wait for rate limit reset while persisting lifecycle timing."""
        wait_time = min(retry_after, MAX_RATE_LIMIT_WAIT)
        reset_at = datetime.now(UTC) + timedelta(seconds=wait_time)

        logger.info("Waiting for rate limit", wait_seconds=wait_time, reset_at=reset_at)
        self._is_waiting_for_rate_limit = True
        await self._set_rate_limit_reset(reset_at)
        await asyncio.sleep(wait_time)

    async def _clear_rate_limit_wait_if_active(self) -> None:
        """Clear persisted rate-limit timing once requests can proceed again."""
        if not self._is_waiting_for_rate_limit:
            return
        self._is_waiting_for_rate_limit = False
        await self._set_rate_limit_reset(None, force_clear=True)

    async def _set_rate_limit_reset(
        self,
        reset_at: datetime | None,
        force_clear: bool = False,
    ) -> None:
        """Update the persisted rate-limit lifecycle timing."""
        if not self._has_current_analysis():
            return
        try:
            result = await self.db.execute(
                select(MatchmakingAnalysis.rate_limit_reset_at).where(
                    self._active_run_where(*self._current_run_identity())
                )
            )
            current_reset = result.scalar_one_or_none()
            now = datetime.now(UTC)
            next_reset = self._next_rate_limit_reset(
                reset_at, current_reset, now, force_clear
            )

            await self._write_active_run(
                *self._current_run_identity(),
                status=self._status_for_rate_limit(next_reset),
                rate_limit_reset_at=next_reset,
                requests_saved=self.requests_saved,
            )
        except Exception as e:
            logger.warning(
                "Failed to set rate_limit_reset_at",
                error_type=type(e).__name__,
            )
            await rollback_quietly(self.db)

    def _has_current_analysis(self) -> bool:
        return bool(self._current_analysis_puuid and self._current_analysis_created_at)

    def _current_run_identity(self) -> tuple[str, datetime]:
        """The identity of the run this worker owns; guarded by `_has_current_analysis`."""
        assert self._current_analysis_puuid is not None
        assert self._current_analysis_created_at is not None
        return self._current_analysis_puuid, self._current_analysis_created_at

    @staticmethod
    def _next_rate_limit_reset(
        reset_at: datetime | None,
        current_reset: datetime | None,
        now: datetime,
        force_clear: bool,
    ) -> datetime | None:
        if reset_at is None and not force_clear:
            if current_reset is not None and current_reset > now:
                return current_reset
            return reset_at
        if (
            reset_at is not None
            and current_reset is not None
            and current_reset > reset_at
        ):
            return current_reset
        return reset_at

    @staticmethod
    def _status_for_rate_limit(next_reset: datetime | None) -> str:
        if next_reset is not None:
            return "waiting_rate_limit"
        return "in_progress"
