"""Shared log-then-raise tail for feature routers.

Nearly every route's final except-block logs the unexpected error and
answers a client-safe HTTPException. The tail lives here so its shape
(error string, traceback, context kwargs) cannot drift between routers;
each call site passes its own module logger to keep the log origin.
"""

from typing import Any, NoReturn

from fastapi import HTTPException


def log_and_raise_http(
    logger: Any,
    e: Exception,
    event: str,
    # Usually a plain sentence; structured {code, message} details pass
    # through unchanged, matching what HTTPException itself accepts.
    detail: Any,
    *,
    status_code: int = 500,
    **context: object,
) -> NoReturn:
    """Log the error with its context and answer a client-safe status."""
    logger.error(event, error=str(e), exc_info=e, **context)
    raise HTTPException(status_code=status_code, detail=detail) from e
