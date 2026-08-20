"""The app refuses a request body larger than it has any reason to accept."""

import warnings
from typing import cast

import httpx
import pytest
from starlette.exceptions import StarletteDeprecationWarning

from app.main import app

with warnings.catch_warnings():
    # The suite treats warnings as errors, and starlette's TestClient still
    # warns at import time while it runs on httpx instead of httpx2.
    warnings.simplefilter("ignore", StarletteDeprecationWarning)
    from starlette.testclient import TestClient

LIMIT = 1024 * 1024


def _post_bytes(client: TestClient, size: int) -> httpx.Response:
    """Issue the POST typed as the httpx response it really is.

    starlette's testclient annotates its methods against httpx2, which this
    environment does not install, so the unresolvable stubs are ignored here
    exactly once instead of at every call site.
    """
    response = client.post("/api/v1/auth/login", content=b"x" * size)  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
    return cast(httpx.Response, response)


@pytest.fixture
def client() -> TestClient:
    # No `with`: the body limit runs before routing, so nothing here needs the
    # lifespan's database. Entering it would demand a live Postgres.
    return TestClient(app)


def test_oversized_body_is_refused_before_it_reaches_a_route(
    client: TestClient,
) -> None:
    assert _post_bytes(client, LIMIT + 1).status_code == 413


def test_a_body_under_the_ceiling_still_reaches_routing(
    client: TestClient,
) -> None:
    # Proves the test above is measuring the ceiling rather than the endpoint:
    # the same route, one byte under, gets past the limiter and is answered by
    # the application itself.
    assert _post_bytes(client, LIMIT - 1).status_code != 413
