"""Rate limiting configuration for the application."""

from collections.abc import Callable
from typing import ParamSpec, Protocol, TypeVar, cast

from slowapi import Limiter
from slowapi.util import get_remote_address

# Create rate limiter instance
# key_func determines the key for rate limiting (by default, uses client IP)
limiter = Limiter(key_func=get_remote_address)

_P = ParamSpec("_P")
_R = TypeVar("_R")


class _SupportsLimit(Protocol[_P, _R]):
    """``Limiter.limit`` as it actually behaves, stated for one decoration.

    slowapi annotates the method as returning a bare ``Callable``, which makes
    both the decorator and every endpoint it wraps untyped. Casting the limiter
    to this protocol restores the contract at the member access itself, so no
    part of the expression is left unknown.
    """

    def limit(
        self, limit_value: str
    ) -> Callable[[Callable[_P, _R]], Callable[_P, _R]]: ...


def rate_limit(limit_value: str) -> Callable[[Callable[_P, _R]], Callable[_P, _R]]:
    """Rate-limit an endpoint against the application-wide limiter.

    slowapi annotates ``Limiter.limit`` as returning a bare ``Callable``, so
    applying it directly erases the type of every endpoint it decorates. The
    cast restates the decorator's real contract — it hands back the same
    function it was given — so routers keep their checked signatures.
    """
    return cast("_SupportsLimit[_P, _R]", limiter).limit(limit_value)
