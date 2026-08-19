"""The auth-state hint must stay readable while the tokens stay HttpOnly."""

from datetime import UTC, datetime, timedelta

from fastapi import Response

from app.features.auth.cookies import (
    ACCESS_TOKEN_COOKIE_NAME,
    AUTH_STATE_COOKIE_NAME,
    REFRESH_TOKEN_COOKIE_NAME,
    set_auth_cookies,
)


def _set_cookie_headers() -> dict[str, str]:
    response = Response()
    now = datetime.now(UTC)
    set_auth_cookies(
        response,
        access_token="access",
        refresh_token="refresh",
        access_expires_at=now + timedelta(minutes=15),
        refresh_expires_at=now + timedelta(days=7),
    )
    headers = response.headers.getlist("set-cookie")
    return {header.split("=", 1)[0]: header for header in headers}


def test_tokens_are_httponly_and_the_hint_is_not() -> None:
    """The hint exists to be read by client JS; the tokens must never be.

    Flipping either direction breaks something quietly: HttpOnly on the hint
    puts back the two-request signed-out probe it was added to remove, and
    dropping it from a token would expose a credential to any script on the
    page.
    """
    cookies = _set_cookie_headers()

    for name in (ACCESS_TOKEN_COOKIE_NAME, REFRESH_TOKEN_COOKIE_NAME):
        assert "httponly" in cookies[name].lower(), f"{name} must stay HttpOnly"

    assert "httponly" not in cookies[AUTH_STATE_COOKIE_NAME].lower()


def test_the_hint_lives_exactly_as_long_as_the_refresh_token() -> None:
    """Outliving it is fine; expiring first strands the session.

    `proxy.ts` routes on the hint, so once it is gone the visitor is reported
    signed out -- while the refresh cookie beside it is still there, still
    valid, and JavaScript cannot reach it to spend it. A hardcoded 30 days
    made that certain for anyone who set `jwt_refresh_token_expire_days`
    higher, with no server refusal anywhere in the sequence.
    """
    cookies = _set_cookie_headers()

    def max_age(name: str) -> int:
        for part in cookies[name].split("; "):
            if part.lower().startswith("max-age="):
                return int(part.split("=", 1)[1])
        raise AssertionError(f"{name} has no Max-Age")

    assert max_age(AUTH_STATE_COOKIE_NAME) == max_age(REFRESH_TOKEN_COOKIE_NAME)
