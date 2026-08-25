"""Every URL the frontend asks for must be a URL this app answers.

The two halves deploy separately and agree on nothing but strings, and every
frontend test that touches an API module mocks it, so a mistyped path stays
green until it 404s in a browser. Request and response shapes are not checked.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.main import app

REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND = REPO_ROOT / "frontend"

# The client prepends this to every path it is given (`lib/core/api.ts`).
API_PREFIX = "/api/v1"

# Directories with no request in them, plus the two that would drown the walk.
SKIPPED_DIRS = {"node_modules", ".next", "coverage", "tests", "e2e"}

# The wrappers' own definitions, which name every helper without calling one.
API_MODULE = FRONTEND / "lib" / "core" / "api.ts"

CALL = re.compile(r"validated(Get|Post|Put|Delete|Patch)\s*\(")

# A floor under the call-site count. Without it, a regex that silently stops
# matching -- a rename of the helpers, a formatter that splits the call across
# lines differently -- turns this test into one that checks nothing and passes.
MINIMUM_CALL_SITES = 50

# (file, line, method, path) -- `path` is None when it could not be read.
CallSite = tuple[str, int, str, str | None]


def _read_path(source: str, index: int) -> str | None:
    """The request path of the `validated*` call whose ``(`` ends at `index`.

    The signature is always ``(schema, url, ...)``, so the path is the second
    argument. Returns ``None`` when the second argument is not a literal, which
    the caller reports rather than skips.
    """
    skip_schema = re.match(r"\s*[^,]*?,\s*", source[index:])
    if skip_schema is None:
        return None
    start = index + skip_schema.end()
    quote = source[start]

    if quote in "\"'":
        end = source.index(quote, start + 1)
        return source[start + 1 : end].split("?")[0]

    if quote != "`":
        return None

    # A template literal. Interpolations are path parameters -- until one of
    # them holds a `?`, at which point it is building a query string and the
    # path has ended: `/jobs/${id}/stop${force ? "?force=true" : ""}`.
    out: list[str] = []
    i = start + 1
    while source[i] != "`":
        if source[i : i + 2] == "${":
            depth, body_start = 1, i + 2
            i += 2
            while depth:
                if source[i] == "{":
                    depth += 1
                elif source[i] == "}":
                    depth -= 1
                i += 1
            if "?" in source[body_start : i - 1]:
                break
            out.append("{}")
            continue
        if source[i] == "?":
            break
        out.append(source[i])
        i += 1
    return "".join(out)


def _frontend_sources() -> list[Path]:
    return [
        path
        for path in FRONTEND.rglob("*.ts*")
        if path.suffix in {".ts", ".tsx"}
        and not SKIPPED_DIRS & set(path.relative_to(FRONTEND).parts)
        and path != API_MODULE
    ]


def _call_sites() -> list[CallSite]:
    """Every `validated*` call in the frontend as (file, line, method, path)."""
    sites: list[CallSite] = []
    for path in _frontend_sources():
        source = path.read_text(encoding="utf-8")
        for match in CALL.finditer(source):
            sites.append(
                (
                    str(path.relative_to(REPO_ROOT)),
                    source.count("\n", 0, match.start()) + 1,
                    match.group(1).upper(),
                    _read_path(source, match.end()),
                )
            )
    return sites


def _registered_routes() -> set[tuple[str, str]]:
    """Every (path, method) this app serves, with parameter names erased."""
    return {
        (re.sub(r"\{[^}]*\}", "{}", path).removeprefix(API_PREFIX), method.upper())
        for path, operations in app.openapi()["paths"].items()
        if path.startswith(API_PREFIX)
        for method in operations
    }


@pytest.fixture(scope="module")
def call_sites() -> list[CallSite]:
    return _call_sites()


def test_the_scan_still_finds_the_frontend_requests(
    call_sites: list[CallSite],
) -> None:
    """The guard on the guard: a scan that finds nothing must not pass."""
    assert len(call_sites) >= MINIMUM_CALL_SITES, (
        f"only {len(call_sites)} `validated*` call sites found in {FRONTEND}, "
        f"expected at least {MINIMUM_CALL_SITES}. Either the helpers were "
        f"renamed, or the frontend tree is not where this test looks -- "
        f"raise the floor deliberately, do not lower it."
    )


def test_every_frontend_request_path_is_a_literal(
    call_sites: list[CallSite],
) -> None:
    """A path this test cannot read is a path it cannot check."""
    unreadable = [
        f"{file}:{line}" for file, line, _, path in call_sites if path is None
    ]
    assert not unreadable, (
        "the URL argument is not a string or template literal at: "
        + ", ".join(unreadable)
        + ". Build the path inline at the call site, or teach `_read_path` "
        "about the new shape -- an unreadable path is an unchecked one."
    )


def test_every_frontend_request_matches_a_registered_route(
    call_sites: list[CallSite],
) -> None:
    registered = _registered_routes()
    missing = sorted(
        f"{method} {path}  ({file}:{line})"
        for file, line, method, path in call_sites
        if path is not None and (path, method) not in registered
    )
    assert not missing, (
        "the frontend asks for routes this app does not serve:\n  "
        + "\n  ".join(missing)
        + "\n\nA wrong method is as broken as a wrong path: it answers 405."
    )
