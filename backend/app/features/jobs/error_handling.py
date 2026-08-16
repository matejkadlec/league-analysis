"""Error handling utilities for job execution.

Provides decorators to handle common Riot API errors consistently
across all job types, reducing code duplication and improving maintainability.

Error Handling Strategy:
- Rate limit errors: Convert to RateLimitSignal for graceful handling
- Authentication errors: Always re-raise (critical)
- General errors: Re-raise if critical=True, log and return None otherwise
"""

from collections.abc import Callable, Coroutine, Iterator
from functools import wraps
from typing import Any, Protocol, overload

import structlog
from sqlalchemy.exc import SQLAlchemyError

from app.core.exceptions import DatabaseError
from app.core.riot_api.errors import (
    AuthenticationError,
    ForbiddenError,
    PuuidDecryptionError,
    RateLimitError,
)

logger = structlog.get_logger(__name__)

#: Callback that turns a decorated function's own arguments into log fields.
LogContextExtractor = Callable[..., dict[str, Any]]


class ErrorHandlingDecorator(Protocol):
    """Decorator returned by :func:`handle_riot_api_errors`.

    The wrapper keeps the wrapped function's parameters and may return ``None``
    instead of the wrapped result when a non-critical error is swallowed.
    """

    @overload
    def __call__[**P, R](
        self, func: Callable[P, Coroutine[Any, Any, R]], /
    ) -> Callable[P, Coroutine[Any, Any, R | None]]: ...

    @overload
    def __call__[**P, R](self, func: Callable[P, R], /) -> Callable[P, R | None]: ...


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

        original_error = getattr(current, "original_error", None)
        if isinstance(original_error, Exception):
            current = original_error
        elif isinstance(current.__cause__, Exception):
            current = current.__cause__
        else:
            current = None


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
    return any(
        isinstance(item, (DatabaseError, SQLAlchemyError))
        for item in iter_error_chain(error)
    )


def handle_riot_api_errors(
    *,
    operation: str,
    critical: bool = True,
    log_context: LogContextExtractor | None = None,
) -> ErrorHandlingDecorator:
    """Decorator to handle common Riot API errors with consistent behavior.

    :param operation: Description of the operation (e.g., "fetch matches").
    :param critical: If True, re-raise all exceptions. If False, log and return None.
    :param log_context: Optional function extracting context from args for logging.
                        Example: lambda self, player: {"puuid": player.puuid}

    Error handling logic:
    - RateLimitError: Convert to RateLimitSignal for graceful job termination
    - AuthenticationError/ForbiddenError: Always re-raise (critical auth failures)
    - Other exceptions: Log error, re-raise if critical=True, otherwise return None

    Usage example::

        @handle_riot_api_errors(
            operation="update player",
            critical=False,
            log_context=lambda self, player: {"puuid": player.puuid}
        )
        async def _sync_tracked_player(self, db: AsyncSession, player: Player):
            # Your implementation here
            pass
    """

    @overload
    def decorator[**P, R](
        func: Callable[P, Coroutine[Any, Any, R]], /
    ) -> Callable[P, Coroutine[Any, Any, R | None]]: ...

    @overload
    def decorator[**P, R](func: Callable[P, R], /) -> Callable[P, R | None]: ...

    def decorator(func: Callable[..., Any], /) -> Callable[..., Any]:
        import inspect

        # Choose wrapper based on function type
        if inspect.iscoroutinefunction(func):
            return _create_async_wrapper(func, operation, critical, log_context)
        return _create_sync_wrapper(func, operation, critical, log_context)

    return decorator


def _extract_log_context(
    log_context: LogContextExtractor | None,
    args: tuple[Any, ...],
    kwargs: dict[str, Any],
    func_name: str,
) -> dict[str, Any]:
    """Extract logging context from function arguments."""
    if not log_context:
        return {}

    try:
        return log_context(*args, **kwargs)
    except Exception as e:
        logger.warning(
            "Failed to extract log context",
            error=str(e),
            function=func_name,
        )
        return {}


def _handle_error(
    error: Exception, operation: str, critical: bool, context: dict[str, Any]
) -> None:
    """Handle exceptions with consistent logging and re-raise logic."""
    if isinstance(error, RateLimitError):
        retry_after = getattr(error, "retry_after", None)
        logger.warning(
            f"Rate limit hit during {operation}",
            retry_after=retry_after,
            **context,
        )
        # Convert to RateLimitSignal for graceful job termination
        raise RateLimitSignal(
            retry_after=retry_after, message=f"Rate limit hit during {operation}"
        )

    if isinstance(error, (AuthenticationError, ForbiddenError)):
        logger.error(
            f"Authentication failure during {operation} - job cannot continue",
            error=str(error),
            error_type=type(error).__name__,
            **context,
        )
        raise

    logger.error(
        f"Failed to {operation}",
        error=str(error),
        error_type=type(error).__name__,
        **context,
    )
    if critical:
        raise


def _create_async_wrapper[**P, R](
    func: Callable[P, Coroutine[Any, Any, R]],
    operation: str,
    critical: bool,
    log_context: LogContextExtractor | None,
) -> Callable[P, Coroutine[Any, Any, R | None]]:
    """Create async wrapper for error handling."""

    @wraps(func)
    async def async_wrapper(*args: P.args, **kwargs: P.kwargs) -> R | None:
        # ``@wraps`` has already copied the wrapped function's ``__name__``.
        context = _extract_log_context(
            log_context, args, kwargs, async_wrapper.__name__
        )
        try:
            return await func(*args, **kwargs)
        except RateLimitSignal:
            # Always let RateLimitSignal propagate - it's not an error!
            raise
        except Exception as error:
            _handle_error(error, operation, critical, context)
            return None  # For non-critical errors that don't re-raise

    return async_wrapper


def _create_sync_wrapper[**P, R](
    func: Callable[P, R],
    operation: str,
    critical: bool,
    log_context: LogContextExtractor | None,
) -> Callable[P, R | None]:
    """Create sync wrapper for error handling."""

    @wraps(func)
    def sync_wrapper(*args: P.args, **kwargs: P.kwargs) -> R | None:
        # ``@wraps`` has already copied the wrapped function's ``__name__``.
        context = _extract_log_context(log_context, args, kwargs, sync_wrapper.__name__)
        try:
            return func(*args, **kwargs)
        except RateLimitSignal:
            # Always let RateLimitSignal propagate - it's not an error!
            raise
        except Exception as error:
            _handle_error(error, operation, critical, context)
            return None  # For non-critical errors that don't re-raise

    return sync_wrapper
