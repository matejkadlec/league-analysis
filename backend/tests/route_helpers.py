"""Calling a route function directly, without an ASGI server under it.

Several suites assert what a single endpoint does with a stubbed service, so
they call the coroutine rather than issuing a request. Two things stand in the
way of that, and both were solved identically in four files before this one.
"""

import inspect
from collections.abc import Callable
from typing import cast

from starlette.requests import Request


def undecorated[**P, R](endpoint: Callable[P, R]) -> Callable[P, R]:
    """Return the endpoint that ``rate_limit`` wrapped.

    The wrapper wants limiter state and a fully formed ASGI request that these
    unit tests have no reason to build. ``__wrapped__`` is not described by any
    ``Callable`` type, so the unwrapping is dynamic and the signature restated.
    """
    return cast(Callable[P, R], inspect.unwrap(endpoint))


def loopback_request() -> Request:
    """The minimal request a rate-limited route reads: client address, headers."""
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/",
            "headers": [],
            "client": ("127.0.0.1", 51234),
        }
    )
