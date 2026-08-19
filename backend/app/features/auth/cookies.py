"""HttpOnly auth cookies shared by login, refresh, and logout."""

import os
from datetime import UTC, datetime

from fastapi import Response

ACCESS_TOKEN_COOKIE_NAME = "league_analysis_access_token"
REFRESH_TOKEN_COOKIE_NAME = "league_analysis_refresh_token"
AUTH_STATE_COOKIE_NAME = "league_analysis_auth_state"
AUTH_STATE_COOKIE_VALUE = "1"


def _cookie_secure() -> bool:
    return os.getenv("ENVIRONMENT", "").lower() == "production"


def _max_age_seconds(expires_at: datetime) -> int:
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
    # Measured once, not twice. `_max_age_seconds` truncates against the clock
    # of the moment it is called, so the refresh cookie and the hint below
    # disagreed by a second whenever a whole-second boundary fell between the
    # two calls -- rare, but it is the hint that would be the shorter one, and
    # a hint that expires before the refresh token beside it is the stranded
    # session this whole change exists to remove.
    refresh_max_age = _max_age_seconds(refresh_expires_at)
    response.set_cookie(
        ACCESS_TOKEN_COOKIE_NAME,
        access_token,
        max_age=_max_age_seconds(access_expires_at),
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
    # Deliberately readable by JavaScript, unlike the two above. It carries no
    # secret — only the literal "1" — and its whole job is to answer "is there a
    # session?" without a round trip. `proxy.ts` reads it server-side to route,
    # and `AuthProvider` reads it client-side to decide whether probing
    # /auth/me is worth doing: with it HttpOnly the client could not, so every
    # signed-out visit spent two requests learning what this cookie's absence
    # already says, and logged a browser-generated 401 for each.
    response.set_cookie(
        AUTH_STATE_COOKIE_NAME,
        AUTH_STATE_COOKIE_VALUE,
        # The same lifetime as the refresh token beside it, taken from the
        # same expiry rather than restated. A hardcoded 30 days silently
        # became wrong the moment `jwt_refresh_token_expire_days` was set to
        # anything longer: the hint expired first, `proxy.ts` reported the
        # visitor signed out, and the refresh token stayed live and spendable
        # for the remainder -- a stranded session with no server refusal
        # anywhere in it.
        max_age=refresh_max_age,
        httponly=False,
        secure=secure,
        samesite="lax",
        path="/",
    )


def clear_auth_cookies(response: Response) -> None:
    """Expire every auth cookie. Called by logout, and by logout only.

    A rejected refresh does NOT come through here: `refresh_access_token`
    raises straight out, so a 401 from it carries no Set-Cookie at all and
    leaves the whole jar in place. That is why the browser has to retract the
    session hint itself — without that, `proxy.ts` keeps routing on a cookie
    the server has already stopped honouring.
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
