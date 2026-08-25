"""Shared log-then-raise tail for feature routers.

Nearly every route's final except-block logs the unexpected error and
answers a client-safe HTTPException. The tail lives here so its shape
(error string, traceback, context kwargs) cannot drift between routers;
each call site passes its own module logger to keep the log origin.
"""

from typing import Any, NoReturn

import structlog
from fastapi import HTTPException

# One sentence for every unexpected server error. `normalizeApiError` in the
# frontend only trusts a *structured* `{code, message}` detail, so a plain
# string never reaches a viewer -- its `status >= 500` branch substitutes this
# text. What tells the routes apart is the structured log event.
SERVICE_ERROR_DETAIL = (
    "The League Analysis service could not complete the request. "
    "Please try again later."
)


def log_and_raise_http(
    logger: structlog.stdlib.BoundLogger,
    e: Exception,
    event: str,
    # Structured {code, message} details pass through unchanged, matching
    # what HTTPException itself accepts.
    detail: Any = SERVICE_ERROR_DETAIL,
    *,
    status_code: int = 500,
    **context: object,
) -> NoReturn:
    """Log the error with its context and answer a client-safe status."""
    logger.error(event, error=str(e), exc_info=e, **context)
    raise HTTPException(status_code=status_code, detail=detail) from e


def http_error(
    status_code: int, code: str, message: str, **extra: object
) -> HTTPException:
    """Build the structured `{code, message}` refusal the web client parses."""
    return HTTPException(
        status_code=status_code,
        detail={"code": code, "message": message, **extra},
    )
