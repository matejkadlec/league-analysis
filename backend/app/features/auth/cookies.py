"""HttpOnly auth cookies shared by login, refresh, and logout."""

import os
from datetime import UTC, datetime

from fastapi import Response

ACCESS_TOKEN_COOKIE_NAME = "league_analysis_access_token"
REFRESH_TOKEN_COOKIE_NAME = "league_analysis_refresh_token"
AUTH_STATE_COOKIE_NAME = "league_analysis_auth_state"
AUTH_STATE_COOKIE_VALUE = "1"
AUTH_STATE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30


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
        max_age=_max_age_seconds(refresh_expires_at),
        httponly=True,
        secure=secure,
        samesite="lax",
        path="/",
    )
    response.set_cookie(
        AUTH_STATE_COOKIE_NAME,
        AUTH_STATE_COOKIE_VALUE,
        max_age=AUTH_STATE_COOKIE_MAX_AGE_SECONDS,
        httponly=True,
        secure=secure,
        samesite="lax",
        path="/",
    )


def clear_auth_cookies(response: Response) -> None:
    """Expire every auth cookie on logout or failed refresh."""
    secure = _cookie_secure()
    for name in (
        ACCESS_TOKEN_COOKIE_NAME,
        REFRESH_TOKEN_COOKIE_NAME,
        AUTH_STATE_COOKIE_NAME,
    ):
        response.delete_cookie(
            name,
            path="/",
            httponly=True,
            secure=secure,
            samesite="lax",
        )
