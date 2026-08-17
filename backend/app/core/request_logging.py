"""Pure ASGI middleware that binds request context and logs request completion."""

import time
import uuid

import structlog
from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = structlog.get_logger(__name__)

_REQUEST_ID_LENGTH = 12


def _elapsed_ms(started_at: float) -> float:
    """Return milliseconds since ``started_at``, rounded to one decimal."""
    return round((time.perf_counter() - started_at) * 1000, 1)


def _log_http_request_completed(
    *,
    method: str,
    path: str,
    status_code: int,
    duration_ms: float,
    request_id: str,
) -> None:
    """Log one completion event, escalating the level with the status code."""
    fields: dict[str, object] = {
        "method": method,
        "path": path,
        "status_code": status_code,
        "duration_ms": duration_ms,
        "request_id": request_id,
    }
    if status_code >= 500:
        logger.error("http_request_completed", **fields)
    elif status_code >= 400:
        logger.warning("http_request_completed", **fields)
    elif path.startswith("/health"):
        logger.debug("http_request_completed", **fields)
    else:
        logger.info("http_request_completed", **fields)


class RequestLoggingMiddleware:
    """Bind request contextvars and log exactly one event per HTTP request.

    The contextvars are bound before the inner app runs so every downstream
    log event carries the request context, and cleared after the inner app
    returns. The completion event is logged when the terminal response body
    message passes through, not after the inner app returns: Starlette awaits
    background tasks inside the response call, so waiting would attribute
    background-work time to ``duration_ms`` and delay the event by the whole
    task runtime. Query strings, headers, and bodies are deliberately never
    read.
    """

    def __init__(self, app: ASGIApp) -> None:
        """Wrap ``app``; non-HTTP scopes pass through untouched."""
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Handle one ASGI request lifecycle."""
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        method = scope["method"]
        path = scope["path"]
        request_id = uuid.uuid4().hex[:_REQUEST_ID_LENGTH]
        structlog.contextvars.bind_contextvars(
            request_id=request_id,
            method=method,
            path=path,
        )

        status_code = 0
        completion_logged = False

        async def send_with_status(message: Message) -> None:
            nonlocal status_code, completion_logged
            if message["type"] == "http.response.start":
                status_code = message["status"]
            elif (
                message["type"] == "http.response.body"
                and not message.get("more_body", False)
                and not completion_logged
            ):
                completion_logged = True
                _log_http_request_completed(
                    method=method,
                    path=path,
                    status_code=status_code,
                    duration_ms=_elapsed_ms(started_at),
                    request_id=request_id,
                )
            await send(message)

        started_at = time.perf_counter()
        try:
            try:
                await self.app(scope, receive, send_with_status)
            except Exception:
                logger.error(
                    "http_request_exception",
                    method=method,
                    path=path,
                    duration_ms=_elapsed_ms(started_at),
                    request_id=request_id,
                    exc_info=True,
                )
                raise
            if not completion_logged:
                # Safety net: the inner app finished without a terminal body
                # message, so the wrapper never fired; keep the one-event
                # guarantee.
                _log_http_request_completed(
                    method=method,
                    path=path,
                    status_code=status_code,
                    duration_ms=_elapsed_ms(started_at),
                    request_id=request_id,
                )
        finally:
            structlog.contextvars.clear_contextvars()
