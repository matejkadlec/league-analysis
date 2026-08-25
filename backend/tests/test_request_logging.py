"""RequestLoggingMiddleware behavior, asserted through captured structlog events."""

from collections.abc import AsyncIterator, Callable

import httpx
import pytest
from fastapi import BackgroundTasks, FastAPI, HTTPException
from starlette.types import Message, Receive, Scope, Send
from structlog import get_logger
from structlog.contextvars import merge_contextvars
from structlog.testing import capture_logs
from structlog.typing import EventDict

from app.core.request_logging import RequestLoggingMiddleware

route_logger = get_logger("tests.test_request_logging")

_OK = {"status": "ok"}


async def _ok() -> dict[str, str]:
    return _OK


async def _health_ping() -> dict[str, str]:
    return {"status": "ping"}


async def _missing() -> dict[str, str]:
    raise HTTPException(status_code=404, detail="Not found")


async def _failing() -> dict[str, str]:
    raise HTTPException(status_code=500, detail="Internal error")


async def _boom() -> dict[str, str]:
    raise RuntimeError("route exploded")


async def _context() -> dict[str, str]:
    route_logger.info("route_handler_reached")
    return _OK


async def _background_task() -> None:
    route_logger.info("bg_task_marker")


async def _background(background_tasks: BackgroundTasks) -> dict[str, str]:
    background_tasks.add_task(_background_task)
    return _OK


_ROUTES: list[tuple[str, Callable[..., object]]] = [
    ("/ok", _ok),
    ("/health/ping", _health_ping),
    ("/missing", _missing),
    ("/failing", _failing),
    ("/boom", _boom),
    ("/context", _context),
    ("/background", _background),
]


def _build_app() -> FastAPI:
    """A minimal app exercising every middleware branch the tests assert on."""
    app = FastAPI()
    app.add_middleware(RequestLoggingMiddleware)
    for path, handler in _ROUTES:
        app.add_api_route(path, handler)
    return app


@pytest.fixture
async def client() -> AsyncIterator[httpx.AsyncClient]:
    """The middleware under a real ASGI stack, with no lifespan driven.

    `ASGITransport`, not starlette's TestClient: the latter is annotated
    against httpx2, which this environment does not install, and it warns at
    import time in a suite that treats warnings as errors.
    """
    transport = httpx.ASGITransport(app=_build_app())
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as async_client:
        yield async_client


def _events(records: list[EventDict], event: str) -> list[EventDict]:
    return [record for record in records if record["event"] == event]


async def test_successful_request_logs_info_completion(
    client: httpx.AsyncClient,
) -> None:
    with capture_logs() as records:
        response = await client.get("/ok")

    assert response.status_code == 200
    completions = _events(records, "http_request_completed")
    assert len(completions) == 1
    record = completions[0]
    assert record["log_level"] == "info"
    assert record["method"] == "GET"
    assert record["path"] == "/ok"
    assert record["status_code"] == 200
    assert isinstance(record["request_id"], str)
    assert len(record["request_id"]) == 12
    assert isinstance(record["duration_ms"], float)
    assert record["duration_ms"] >= 0


async def test_client_error_logs_warning_completion(
    client: httpx.AsyncClient,
) -> None:
    with capture_logs() as records:
        response = await client.get("/missing")

    assert response.status_code == 404
    completions = _events(records, "http_request_completed")
    assert len(completions) == 1
    record = completions[0]
    assert record["log_level"] == "warning"
    assert record["status_code"] == 404


async def test_server_error_response_logs_error_completion(
    client: httpx.AsyncClient,
) -> None:
    with capture_logs() as records:
        response = await client.get("/failing")

    assert response.status_code == 500
    completions = _events(records, "http_request_completed")
    assert len(completions) == 1
    record = completions[0]
    assert record["log_level"] == "error"
    assert record["status_code"] == 500
    assert _events(records, "http_request_exception") == []


async def test_health_probe_logs_debug_completion(
    client: httpx.AsyncClient,
) -> None:
    with capture_logs() as records:
        response = await client.get("/health/ping")

    assert response.status_code == 200
    completions = _events(records, "http_request_completed")
    assert len(completions) == 1
    assert completions[0]["log_level"] == "debug"


async def test_unhandled_exception_logs_exception_event_and_reraises(
    client: httpx.AsyncClient,
) -> None:
    with (
        capture_logs() as records,
        pytest.raises(RuntimeError, match="route exploded"),
    ):
        await client.get("/boom")

    exceptions = _events(records, "http_request_exception")
    assert len(exceptions) == 1
    record = exceptions[0]
    assert record["log_level"] == "error"
    assert record["method"] == "GET"
    assert record["path"] == "/boom"
    assert len(record["request_id"]) == 12
    assert isinstance(record["duration_ms"], float)
    assert record["exc_info"] is True
    assert _events(records, "http_request_completed") == []


async def test_downstream_logs_carry_request_context(
    client: httpx.AsyncClient,
) -> None:
    with capture_logs(processors=[merge_contextvars]) as records:
        response = await client.get("/context")

    assert response.status_code == 200
    handler_events = _events(records, "route_handler_reached")
    assert len(handler_events) == 1
    handler_record = handler_events[0]
    assert handler_record["method"] == "GET"
    assert handler_record["path"] == "/context"
    completion = _events(records, "http_request_completed")[0]
    assert handler_record["request_id"] == completion["request_id"]


async def test_non_http_scope_passes_through_without_request_logging() -> None:
    """The lifespan scope must reach the app untouched and log nothing.

    `ASGITransport` never sends a non-http scope at all, so the middleware is
    called directly here; a round-trip version would go green while covering
    nothing.
    """
    middleware = RequestLoggingMiddleware(_silent_app)

    with capture_logs() as records:
        await middleware({"type": "lifespan"}, _no_receive, _no_send)

    assert records == []


async def test_background_task_completion_is_logged_before_the_task_runs(
    client: httpx.AsyncClient,
) -> None:
    """Starlette awaits background tasks inside the response call, so the
    completion event must fire when the response body is sent, not when the
    inner app returns — otherwise duration_ms covers the task runtime."""
    with capture_logs(processors=[merge_contextvars]) as records:
        response = await client.get("/background")

    assert response.status_code == 200
    completion_index = next(
        i
        for i, record in enumerate(records)
        if record["event"] == "http_request_completed"
    )
    marker_index = next(
        i for i, record in enumerate(records) if record["event"] == "bg_task_marker"
    )
    assert completion_index < marker_index
    # The task still runs inside the bound request context.
    assert (
        records[marker_index]["request_id"] == (records[completion_index]["request_id"])
    )


async def _silent_app(scope: Scope, receive: Receive, send: Send) -> None:
    """An ASGI app that finishes without ever sending a response."""


async def _no_receive() -> Message:
    return {"type": "http.request", "body": b"", "more_body": False}


async def _no_send(_message: Message) -> None:
    return None


async def test_app_without_response_still_logs_one_completion() -> None:
    middleware = RequestLoggingMiddleware(_silent_app)

    with capture_logs() as records:
        await middleware(
            {"type": "http", "method": "GET", "path": "/silent"},
            _no_receive,
            _no_send,
        )

    completions = _events(records, "http_request_completed")
    assert len(completions) == 1
    assert completions[0]["status_code"] == 0
    assert completions[0]["log_level"] == "info"
