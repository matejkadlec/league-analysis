"""Rate limiting configuration for the application."""

from collections.abc import Callable
from typing import Protocol, cast

from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)


class _SupportsLimit[**P, R](Protocol):
    """``Limiter.limit`` as it actually behaves, stated for one decoration.

    slowapi annotates the method as returning a bare ``Callable``, which leaves
    the decorator and every endpoint it wraps untyped.
    """

    def limit(self, limit_value: str) -> Callable[[Callable[P, R]], Callable[P, R]]: ...


def rate_limit[**P, R](limit_value: str) -> Callable[[Callable[P, R]], Callable[P, R]]:
    """Rate-limit an endpoint against the application-wide limiter.

    Applying ``Limiter.limit`` directly erases the type of every endpoint it
    decorates; the cast keeps routers' signatures checked.
    """
    return cast("_SupportsLimit[P, R]", limiter).limit(limit_value)
