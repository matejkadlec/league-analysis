"""Shared log-then-raise tail for feature routers.

Nearly every route's final except-block logs the unexpected error and
answers a client-safe HTTPException. The tail lives here so its shape
(error string, traceback, context kwargs) cannot drift between routers;
each call site passes its own module logger to keep the log origin.
"""

from typing import Any, NoReturn

import structlog
from fastapi import HTTPException

# One sentence for every unexpected server error, matching what the web
# client shows anyway.
#
# The routes used to carry ~25 distinct sentences, none of which reached a
# viewer: `normalizeApiError` in the frontend only trusts a *structured*
# `{code, message}` detail, and every one of these was a plain string, so its
# `status >= 500` branch substituted exactly this text every time. What tells
# the routes apart is the structured log event, which is not going anywhere.
#
# A route with something genuinely more useful to say still passes its own
# detail; that is what the `detail` argument is for.
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
