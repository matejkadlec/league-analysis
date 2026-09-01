"""The cookie names this API writes are names the frontend and the policy state.

Nothing links the two sides: a rename here routes a signed-in visitor as signed
out in `proxy.ts`, and leaves the published policy naming cookies nobody sets.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.features.auth.tokens.cookies import (
    ACCESS_TOKEN_COOKIE_NAME,
    AUTH_STATE_COOKIE_NAME,
    AUTH_STATE_COOKIE_VALUE,
    REFRESH_TOKEN_COOKIE_NAME,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND = REPO_ROOT / "frontend"

# Where the frontend hardcodes the hint, and where the site publishes all three.
HINT_MODULE = FRONTEND / "lib" / "session" / "auth-state-cookie.ts"
COOKIE_POLICY = FRONTEND / "app" / "cookie-policy" / "page.tsx"

# `export const NAME = "value";` -- the whole frontend imports these two.
DECLARATION = re.compile(r'export\s+const\s+(\w+)\s*=\s*"([^"]*)"')
# The policy table renders each name through one helper, per row.
PUBLISHED_NAME = re.compile(r'storageName\(\s*"([^"]*)"\s*\)')

# Consent is published too, so the three auth cookies are not the whole table.
MINIMUM_PUBLISHED_NAMES = 4


@pytest.fixture(scope="module")
def hint_declarations() -> dict[str, str]:
    return dict(DECLARATION.findall(HINT_MODULE.read_text(encoding="utf-8")))


@pytest.fixture(scope="module")
def published_names() -> list[str]:
    return PUBLISHED_NAME.findall(COOKIE_POLICY.read_text(encoding="utf-8"))


def test_the_frontend_sources_are_still_where_this_test_reads_them(
    hint_declarations: dict[str, str], published_names: list[str]
) -> None:
    """The guard on the guard: a file that moved would agree with anything.

    Both sides are read by regex, so a missed match is silence, not a failure.
    """
    assert "AUTH_STATE_COOKIE_NAME" in hint_declarations, (
        f'no `export const AUTH_STATE_COOKIE_NAME = "..."` found in '
        f"{HINT_MODULE}. Point this test at the module that declares it -- an "
        f"unparsed declaration is an unchecked one."
    )
    assert len(published_names) >= MINIMUM_PUBLISHED_NAMES, (
        f"only {len(published_names)} `storageName(...)` rows found in "
        f"{COOKIE_POLICY}, expected at least {MINIMUM_PUBLISHED_NAMES}. Either "
        f"the policy table stopped naming cookies through that helper, or it "
        f"moved -- raise the floor deliberately, do not lower it."
    )


def test_the_frontend_hint_constants_match_the_cookie_this_api_writes(
    hint_declarations: dict[str, str],
) -> None:
    """`proxy.ts` reads the visitor's session out of these two literals."""
    assert hint_declarations["AUTH_STATE_COOKIE_NAME"] == AUTH_STATE_COOKIE_NAME
    assert hint_declarations["AUTH_STATE_COOKIE_VALUE"] == AUTH_STATE_COOKIE_VALUE


def test_the_cookie_policy_publishes_every_name_this_api_sets(
    published_names: list[str],
) -> None:
    """A rename would leave the published table describing cookies nobody sets."""
    unpublished = sorted(
        {
            ACCESS_TOKEN_COOKIE_NAME,
            REFRESH_TOKEN_COOKIE_NAME,
            AUTH_STATE_COOKIE_NAME,
        }
        - set(published_names)
    )

    assert not unpublished, (
        f"the cookie policy at {COOKIE_POLICY} does not name {unpublished}, "
        f"which this API sets on every login. The published table is the "
        f"consent disclosure: rename the row with the cookie."
    )
