"""Error classification shared by the job implementations.

`RateLimitSignal` plus a handful of predicates that answer what a caught
exception means -- an expired Riot key, a PUUID minted under a different key,
a database failure that must abort the run. Each job decides for itself what
to do about the answer; there is no shared handler, because the three jobs
disagree about which errors are fatal.
"""

from collections.abc import Iterator

import structlog
from sqlalchemy.exc import SQLAlchemyError

from app.core.riot_api.errors import (
    AuthenticationError,
    ForbiddenError,
    PuuidDecryptionError,
)

logger = structlog.get_logger(__name__)


class RateLimitSignal(Exception):
    """Signal that a rate limit was hit during job execution.

    This is NOT a failure - it signals that the job should stop gracefully
    and save its progress with a RATE_LIMITED status.

    :param retry_after: Seconds to wait before retrying (from Riot API)
    :param message: Optional message describing the rate limit
    """

    def __init__(
        self, retry_after: float | None = None, message: str = "Rate limit hit"
    ):
        """Initialize rate limit signal.

        :param retry_after: Seconds to wait before retrying
        :param message: Description of rate limit condition
        """
        self.retry_after = retry_after
        self.message = message
        super().__init__(message)


def iter_error_chain(error: Exception) -> Iterator[Exception]:
    """Yield a wrapped exception and its reviewed causes without looping forever."""
    current: Exception | None = error
    seen: set[int] = set()

    while current is not None and id(current) not in seen:
        seen.add(id(current))
        yield current

        # `__cause__` only: `ServiceException` used to carry a second,
        # hand-rolled `original_error` chain that no production site ever
        # populated -- `raise ... from` is the one the language already has.
        current = (
            current.__cause__ if isinstance(current.__cause__, Exception) else None
        )


def diagnostic_error(error: Exception) -> Exception:
    """Return the most specific reviewed exception available for diagnostics."""
    chain = list(iter_error_chain(error))
    return chain[-1] if chain else error


def is_riot_api_key_error(error: Exception) -> bool:
    """Return whether Riot rejected or cannot obtain the configured API key."""
    return any(
        isinstance(item, (AuthenticationError, ForbiddenError))
        or getattr(item, "status_code", None) in (401, 403)
        for item in iter_error_chain(error)
    )


def is_riot_puuid_binding_error(error: Exception) -> bool:
    """Return whether Riot rejected a PUUID issued to another developer account."""
    return any(
        isinstance(item, PuuidDecryptionError) for item in iter_error_chain(error)
    )


def is_database_job_error(error: Exception) -> bool:
    """Return whether continuing would reuse a failed or unavailable DB session."""
    return any(isinstance(item, SQLAlchemyError) for item in iter_error_chain(error))
