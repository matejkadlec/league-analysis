"""The app refuses a request body larger than it has any reason to accept."""

from collections.abc import AsyncIterator

import httpx
import pytest

from app.main import app

LIMIT = 1024 * 1024


@pytest.fixture
async def client() -> AsyncIterator[httpx.AsyncClient]:
    # `ASGITransport`, not starlette's TestClient, which is annotated against an
    # httpx2 that is not installed. No lifespan: the limit runs before routing.
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as async_client:
        yield async_client


async def test_oversized_body_is_refused_before_it_reaches_a_route(
    client: httpx.AsyncClient,
) -> None:
    response = await client.post("/api/v1/auth/login", content=b"x" * (LIMIT + 1))

    assert response.status_code == 413


async def test_a_body_under_the_ceiling_still_reaches_routing(
    client: httpx.AsyncClient,
) -> None:
    # Proves the test above measures the ceiling, not the endpoint: the same
    # route one byte under gets past the limiter.
    response = await client.post("/api/v1/auth/login", content=b"x" * (LIMIT - 1))

    assert response.status_code != 413
