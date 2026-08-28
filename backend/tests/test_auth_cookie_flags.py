"""The auth-state hint must stay readable while the tokens stay HttpOnly."""

from datetime import UTC, datetime, timedelta, tzinfo
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import Request, Response

from app.features.auth.router import login, refresh_access_token
from app.features.auth.service import AuthService
from app.features.auth.tokens import cookies as cookies_module
from app.features.auth.tokens.cookies import (
    ACCESS_TOKEN_COOKIE_NAME,
    AUTH_STATE_COOKIE_NAME,
    AUTH_STATE_COOKIE_VALUE,
    REFRESH_TOKEN_COOKIE_NAME,
    set_auth_cookies,
)
from app.features.auth.tokens.token_service import RefreshRotation, TokenPair


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
    dropping it from a token would expose a credential to any script.
    """
    cookies = _set_cookie_headers()

    for name in (ACCESS_TOKEN_COOKIE_NAME, REFRESH_TOKEN_COOKIE_NAME):
        assert "httponly" in cookies[name].lower(), f"{name} must stay HttpOnly"

    assert "httponly" not in cookies[AUTH_STATE_COOKIE_NAME].lower()


def test_the_hint_lives_exactly_as_long_as_the_refresh_token() -> None:
    """Outliving it is fine; expiring first strands the session.

    `proxy.ts` routes on the hint, so once it is gone the visitor is reported
    signed out -- while the refresh cookie beside it is still there, still
    valid, and JavaScript cannot reach it to spend it.
    """
    cookies = _set_cookie_headers()

    def max_age(name: str) -> int:
        for part in cookies[name].split("; "):
            if part.lower().startswith("max-age="):
                return int(part.split("=", 1)[1])
        raise AssertionError(f"{name} has no Max-Age")

    assert max_age(AUTH_STATE_COOKIE_NAME) == max_age(REFRESH_TOKEN_COOKIE_NAME)


def test_the_two_lifetimes_are_measured_once_not_twice(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The test above only catches this about once in a hundred thousand runs.

    `max_age_seconds` truncates against the clock of the moment it is called,
    so measuring twice can leave the hint, written second, a second shorter
    than the refresh token. This clock advances a second per reading.
    """

    class _AdvancingClock:
        readings = 0

        @classmethod
        def now(cls, tz: tzinfo | None = None) -> datetime:
            cls.readings += 1
            return datetime(2026, 1, 1, tzinfo=UTC) + timedelta(seconds=cls.readings)

    monkeypatch.setattr(cookies_module, "datetime", _AdvancingClock)

    response = Response()
    expires = datetime(2026, 2, 1, tzinfo=UTC)
    set_auth_cookies(
        response,
        access_token="access",
        refresh_token="refresh",
        access_expires_at=expires,
        refresh_expires_at=expires,
    )
    written = {
        header.split("=", 1)[0]: header
        for header in response.headers.getlist("set-cookie")
    }

    def max_age(name: str) -> int:
        for part in written[name].split("; "):
            if part.lower().startswith("max-age="):
                return int(part.split("=", 1)[1])
        raise AssertionError(f"{name} has no Max-Age")

    assert max_age(AUTH_STATE_COOKIE_NAME) == max_age(REFRESH_TOKEN_COOKIE_NAME)


def test_the_hint_is_written_host_only() -> None:
    """No Domain, because the browser is what has to delete it.

    A refused refresh answers with no Set-Cookie at all, so only
    `clearAuthStateCookie` in the frontend retracts the hint. Domain is part
    of a cookie's identity, and a `Domain=` the delete misses strands it.
    """
    cookies = _set_cookie_headers()

    assert "domain=" not in cookies[AUTH_STATE_COOKIE_NAME].lower()


def test_the_hint_is_written_exactly_as_the_frontend_hardcodes_it() -> None:
    """The other half of a coupling with no compiler between its ends.

    `proxy.ts` routes on `request.cookies.get(NAME)?.value === VALUE` and
    `auth-state-cookie.ts` deletes by name at `path=/`, both as literal
    TypeScript strings; SameSite=Lax is what sends the hint on a navigation.
    """
    cookies = _set_cookie_headers()
    hint = cookies[AUTH_STATE_COOKIE_NAME].lower()

    assert AUTH_STATE_COOKIE_NAME == "league_analysis_auth_state"
    assert AUTH_STATE_COOKIE_VALUE == "1"
    assert cookies[AUTH_STATE_COOKIE_NAME].startswith(
        f"{AUTH_STATE_COOKIE_NAME}={AUTH_STATE_COOKIE_VALUE};"
    )
    assert "path=/;" in hint or hint.endswith("path=/")
    assert "samesite=lax" in hint
    # The names the frontend proxy and the axios client spell out too.
    assert ACCESS_TOKEN_COOKIE_NAME == "league_analysis_access_token"
    assert REFRESH_TOKEN_COOKIE_NAME == "league_analysis_refresh_token"


def _assert_the_session_was_installed(response: Response) -> None:
    """The three cookies, carrying the right tokens, for the right lengths.

    Names alone are not enough: passing the *old* refresh token leaves the
    browser holding what the rotation just revoked, and `access_expires_at`
    on the refresh cookie gives it a 30-minute life against a 30-day row.
    """
    written = {
        header.split("=", 1)[0]: header
        for header in response.headers.getlist("set-cookie")
    }
    assert set(written) == {
        ACCESS_TOKEN_COOKIE_NAME,
        REFRESH_TOKEN_COOKIE_NAME,
        AUTH_STATE_COOKIE_NAME,
    }
    assert written[ACCESS_TOKEN_COOKIE_NAME].startswith(
        f"{ACCESS_TOKEN_COOKIE_NAME}=access;"
    )
    assert written[REFRESH_TOKEN_COOKIE_NAME].startswith(
        f"{REFRESH_TOKEN_COOKIE_NAME}=refresh;"
    )
    assert written[AUTH_STATE_COOKIE_NAME].startswith(
        f"{AUTH_STATE_COOKIE_NAME}={AUTH_STATE_COOKIE_VALUE};"
    )

    def max_age(name: str) -> int:
        for part in written[name].split("; "):
            if part.lower().startswith("max-age="):
                return int(part.split("=", 1)[1])
        raise AssertionError(f"{name} has no Max-Age")

    # Relative, not absolute seconds: the hint has to outlive nothing and
    # outlast the access token, and it has to match the refresh cookie exactly
    # -- which is what pairing them to the same expiry is for.
    assert max_age(AUTH_STATE_COOKIE_NAME) == max_age(REFRESH_TOKEN_COOKIE_NAME)
    assert max_age(REFRESH_TOKEN_COOKIE_NAME) > max_age(ACCESS_TOKEN_COOKIE_NAME)


def _route_request(cookie: bytes = b"") -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/v1/auth/refresh",
            "headers": [(b"cookie", cookie)] if cookie else [],
            "query_string": b"",
            "client": ("127.0.0.1", 1234),
        }
    )


def _active_user() -> MagicMock:
    user = MagicMock()
    user.id = 5
    user.email = "user@example.com"
    user.is_active = True
    return user


async def test_a_successful_refresh_installs_the_new_cookies() -> None:
    """Rotation without the Set-Cookie breaks the session, not just one call.

    The server revokes the old row and commits the new token either way, so a
    refresh that forgets to install it leaves the browser holding the token
    that was just revoked, with an access cookie that never updates.
    """
    now = datetime.now(UTC)
    service = MagicMock(spec=AuthService)
    service.rotate_refresh_token = AsyncMock(
        return_value=RefreshRotation(
            _active_user(),
            TokenPair(
                "access",
                now + timedelta(minutes=30),
                "refresh",
                now + timedelta(days=30),
            ),
        )
    )
    service.cleanup_expired_token_state = AsyncMock()
    response = Response()

    await refresh_access_token(
        request=_route_request(f"{REFRESH_TOKEN_COOKIE_NAME}=old".encode()),
        response=response,
        refresh_request=None,
        auth_service=cast(AuthService, service),
    )

    _assert_the_session_was_installed(response)


async def test_a_successful_login_installs_the_cookies() -> None:
    """The same for the first pair: no hint, no session, however valid it is.

    `proxy.ts` routes on the hint alone, so a login that issues tokens without
    writing it bounces the visitor straight back to /sign-in -- signed in on
    the server, signed out everywhere they can see.
    """
    from fastapi.security import OAuth2PasswordRequestForm

    now = datetime.now(UTC)
    service = MagicMock(spec=AuthService)
    service.authenticate_user = AsyncMock(return_value=_active_user())
    service.issue_token_pair = AsyncMock(
        return_value=TokenPair(
            access_token="access",
            access_expires_at=now + timedelta(minutes=30),
            refresh_token="refresh",
            refresh_expires_at=now + timedelta(days=30),
        )
    )
    service.update_last_login = AsyncMock()
    service.cleanup_expired_token_state = AsyncMock()
    response = Response()

    await login(
        request=_route_request(),
        response=response,
        form_data=OAuth2PasswordRequestForm(
            username="user@example.com", password="secret"
        ),
        captcha_token=None,
        auth_service=cast(AuthService, service),
    )

    _assert_the_session_was_installed(response)


@pytest.mark.parametrize(
    ("environment", "expect_secure"),
    [("production", True), ("test", False), ("dev", False)],
)
def test_secure_tracks_the_environment(
    monkeypatch: pytest.MonkeyPatch, environment: str, expect_secure: bool
) -> None:
    """The one attribute deciding whether the browser stores the cookie at all.

    The suite runs with ENVIRONMENT=test, so `_cookie_secure()` answered False
    everywhere and both ways of breaking it passed. The settings object is
    `@cache`d, so `monkeypatch.setenv` is inert -- substitute at the reader.
    """
    monkeypatch.setattr(
        cookies_module,
        "get_global_settings",
        lambda: SimpleNamespace(environment=environment),
    )
    cookies = _set_cookie_headers()

    for name in (
        ACCESS_TOKEN_COOKIE_NAME,
        REFRESH_TOKEN_COOKIE_NAME,
        AUTH_STATE_COOKIE_NAME,
    ):
        assert ("secure" in cookies[name].lower()) is expect_secure, name
