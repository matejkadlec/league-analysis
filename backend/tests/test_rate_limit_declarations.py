"""The rate limits themselves, which nothing exercised.

Every route test strips the decorator (`route_helpers.undecorated`), so nothing
else would notice login's `5/minute` becoming `5000/minute`.
"""

from __future__ import annotations

# Importing the app is what registers every router, and therefore every limit.
import app.main
from app.core.http_rate_limit import limiter

DECLARED_LIMITS: dict[str, str] = {
    "app.features.auth.router.login": "5 per 1 minute",
    "app.features.auth.router.register_user": "3 per 1 minute",
    "app.features.auth.router.refresh_access_token": "20 per 1 minute",
    "app.features.auth.router.submit_join_us_contact": "5 per 1 minute",
    "app.features.auth.router.request_email_change_code": "10 per 1 minute",
    "app.features.auth.router.verify_email_change_code": "15 per 1 minute",
    "app.features.auth.router.change_password": "10 per 1 minute",
    "app.features.matchmaking_analysis.router.start_analysis": "10 per 1 minute",
    "app.features.players.router.discover_player": "30 per 1 minute",
    "app.features.players.router.start_player_sync": "10 per 1 minute",
    "app.features.players.router.track_player": "10 per 1 minute",
    "app.features.playstyle_analysis.router.analyze_playstyle": "10 per 1 minute",
    "app.features.smurf_boost_detection.router.analyze_player": "20 per 1 minute",
}


def _registered_limits() -> dict[str, list[str]]:
    return {
        endpoint: [str(limit.limit) for limit in limits]
        for endpoint, limits in limiter._route_limits.items()
    }


def test_every_limited_endpoint_declares_the_limit_it_is_listed_with() -> None:
    registered = _registered_limits()
    drifted = sorted(
        f"{endpoint}: listed {expected}, declares {registered[endpoint]}"
        for endpoint, expected in DECLARED_LIMITS.items()
        if endpoint in registered and registered[endpoint] != [expected]
    )
    assert not drifted, (
        "rate limits changed without the table changing:\n  " + "\n  ".join(drifted)
    )


def test_no_endpoint_gains_or_loses_its_limit_unnoticed() -> None:
    registered = _registered_limits()
    unlimited = sorted(set(DECLARED_LIMITS) - set(registered))
    unlisted = sorted(set(registered) - set(DECLARED_LIMITS))
    assert not unlimited, (
        "these endpoints are no longer rate limited:\n  " + "\n  ".join(unlimited)
    )
    assert not unlisted, (
        "newly rate-limited endpoints with no entry here:\n  " + "\n  ".join(unlisted)
    )


def test_the_limiter_is_wired_into_the_app() -> None:
    """A limit slowapi never consults is a comment.

    The decorator records the limit whether or not the middleware and handler are
    installed, so the declarations above mean nothing on their own.
    """
    from slowapi.errors import RateLimitExceeded

    assert app.main.app.state.limiter is limiter
    assert RateLimitExceeded in app.main.app.exception_handlers
