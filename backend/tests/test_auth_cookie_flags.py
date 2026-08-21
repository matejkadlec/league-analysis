"""The auth-state hint must stay readable while the tokens stay HttpOnly."""

from datetime import UTC, datetime, timedelta, tzinfo
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import Request, Response

from app.features.auth import cookies as cookies_module
from app.features.auth.cookies import (
    ACCESS_TOKEN_COOKIE_NAME,
    AUTH_STATE_COOKIE_NAME,
    AUTH_STATE_COOKIE_VALUE,
    REFRESH_TOKEN_COOKIE_NAME,
    set_auth_cookies,
)
from app.features.auth.router import login, refresh_access_token
from app.features.auth.service import AuthService


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


def test_the_two_lifetimes_are_measured_once_not_twice(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The test above only catches this about once in a hundred thousand runs.

    `max_age_seconds` truncates against the clock of the moment it is called,
    so computing it separately for the refresh cookie and for the hint left
    them a second apart whenever a whole-second boundary fell between the two
    calls -- and the hint, written second, is the one that came out shorter.
    A hint expiring before the refresh token beside it is the stranded
    session, so "the same lifetime" has to be one measurement, not two that
    usually agree.

    Rather than wait for a boundary, move it: this clock advances a second per
    reading, so a second call cannot agree with the first.
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

    A refused refresh answers with no Set-Cookie at all, so the only thing
    that retracts the hint on that path is `clearAuthStateCookie` in the
    frontend -- a different language in a different directory, with no
    automated check between them. Domain is part of a cookie's identity, so a
    `Domain=` here that the delete does not name would leave the hint standing
    through every teardown: "Can't reach the server" forever, with `proxy.ts`
    still admitting the visitor and no way out but clearing cookies by hand.

    The delete now expires the hint under every parent domain of the current
    host as well, so sharing the session across subdomains is survivable --
    but this test is the tripwire that makes it a decision rather than an
    accident.
    """
    cookies = _set_cookie_headers()

    assert "domain=" not in cookies[AUTH_STATE_COOKIE_NAME].lower()


def test_the_hint_is_written_exactly_as_the_frontend_hardcodes_it() -> None:
    """The other half of a coupling with no compiler between its ends.

    `proxy.ts` routes on `request.cookies.get(NAME)?.value === VALUE`, and
    `auth-state-cookie.ts` deletes by name at `path=/`. Both sides are literal
    strings in TypeScript; nothing imports them from here, and nothing
    translates. Rename or revalue this cookie and every signed-in visitor is
    reported signed out on their next navigation, with the refresh cookie
    beside it live and unreachable. Narrow its Path and the delete stops
    matching, so the hint survives every teardown instead -- "can't reach the
    server" forever.

    SameSite is the third: Lax is what sends the hint on a top-level
    navigation, so Strict here would report anyone arriving from an external
    link as signed out, and None would ship it on every cross-site request.

    The literals are duplicated on purpose. This test is the check, and it
    fails the moment either side moves without the other.
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

    Names alone are not enough, and the ways to get this wrong are all one
    word: passing the *old* refresh token (the variable is right there in
    scope) leaves the browser holding what the rotation just revoked, so the
    next refresh is reuse and reuse detection revokes every device. Passing
    `access_expires_at` for the refresh cookie gives it and the hint a
    30-minute life against a 30-day row, so the visitor is reported signed out
    on the next navigation with a live token nothing holds.
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
    """Rotation without the Set-Cookie is a permanent lockout, not a blip.

    The server revokes the old row and commits the new token either way, so a
    refresh that forgets to install it leaves the browser holding the token
    that was just revoked. Presenting it is reuse, and reuse detection revokes
    the entire family -- every device, no way back, and signing in again
    strands again one rotation later. Nothing else in the suite reaches this:
    `set_auth_cookies` is tested in isolation above, and deleting the call
    from the route left all 603 tests green.
    """
    now = datetime.now(UTC)
    service = MagicMock(spec=AuthService)
    service.rotate_refresh_token = AsyncMock(
        return_value=(
            _active_user(),
            "access",
            now + timedelta(minutes=30),
            "refresh",
            now + timedelta(days=30),
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
        return_value=(
            "access",
            now + timedelta(minutes=30),
            "refresh",
            now + timedelta(days=30),
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
    everywhere and both ways of breaking it passed: hardcoding False ships a
    30-day HttpOnly refresh token over plaintext to anyone on the path, and
    hardcoding True over an http origin makes the browser discard all three
    Set-Cookie headers -- /login answers 200, the hint never lands, and the
    gate bounces the visitor straight back to /sign-in with no message, for
    ever. That second one is reachable by configuration, not hypothesis:
    `deploy/production.env.example` names an http origin while
    `compose.production.yml` sets ENVIRONMENT=production.

    The other tests in this file read the same headers, so they need the
    environment they were written under; only this one varies it.

    The settings object is `@cache`d, so `monkeypatch.setenv` would be inert
    here -- the environment is substituted at the reader instead. There is no
    "absent" case any more: `environment` is a required settings field, so a
    missing ENVIRONMENT is a startup error rather than a quiet `dev`.
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
