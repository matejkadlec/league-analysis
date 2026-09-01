"""HttpOnly auth cookies shared by login, refresh, and logout."""

from datetime import UTC, datetime

from fastapi import Response

from app.core.config import get_global_settings

ACCESS_TOKEN_COOKIE_NAME = "league_analysis_access_token"
REFRESH_TOKEN_COOKIE_NAME = "league_analysis_refresh_token"
AUTH_STATE_COOKIE_NAME = "league_analysis_auth_state"
AUTH_STATE_COOKIE_VALUE = "1"


def _cookie_secure() -> bool:
    return get_global_settings().environment == "production"


def max_age_seconds(expires_at: datetime) -> int:
    remaining = expires_at.astimezone(UTC) - datetime.now(UTC)
    return max(0, int(remaining.total_seconds()))


def set_auth_cookies(
    response: Response,
    *,
    access_token: str,
    refresh_token: str,
    access_expires_at: datetime,
    refresh_expires_at: datetime,
) -> None:
    """Persist tokens as HttpOnly cookies so browser JS cannot read them."""
    secure = _cookie_secure()
    # Measured once: `max_age_seconds` truncates against the clock at call time,
    # so a second call could strand the hint below the refresh cookie.
    refresh_max_age = max_age_seconds(refresh_expires_at)
    response.set_cookie(
        ACCESS_TOKEN_COOKIE_NAME,
        access_token,
        max_age=max_age_seconds(access_expires_at),
        httponly=True,
        secure=secure,
        samesite="lax",
        path="/",
    )
    response.set_cookie(
        REFRESH_TOKEN_COOKIE_NAME,
        refresh_token,
        max_age=refresh_max_age,
        httponly=True,
        secure=secure,
        samesite="lax",
        path="/",
    )
    # Deliberately readable by JavaScript, unlike the two above: it carries no
    # secret and answers "is there a session?" without a round trip.
    response.set_cookie(
        AUTH_STATE_COOKIE_NAME,
        AUTH_STATE_COOKIE_VALUE,
        # Must match the refresh cookie: a hint that expires first makes
        # `proxy.ts` report signed out while the refresh token is still spendable.
        max_age=refresh_max_age,
        httponly=False,
        secure=secure,
        samesite="lax",
        path="/",
    )


def clear_auth_cookies(response: Response) -> None:
    """Expire every auth cookie. Called by logout, and by logout only.

    A rejected refresh does NOT come through here: its 401 carries no Set-Cookie,
    so the browser has to retract the session hint itself.
    """
    secure = _cookie_secure()
    for name in (
        ACCESS_TOKEN_COOKIE_NAME,
        REFRESH_TOKEN_COOKIE_NAME,
        AUTH_STATE_COOKIE_NAME,
    ):
        response.delete_cookie(
            name,
            path="/",
            httponly=name != AUTH_STATE_COOKIE_NAME,
            secure=secure,
            samesite="lax",
        )
