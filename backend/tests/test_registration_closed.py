"""Self-registration stays closed.

`POST /api/v1/auth/register` once created an active account for any anonymous
caller, on an application whose accounts its operator alone creates. These
tests keep the route gone, under that name or another.
"""

from __future__ import annotations

import httpx
import pytest
from fastapi.routing import APIRoute

from app.features.auth.router import router as auth_router
from app.main import app

REGISTRATION_PAYLOAD = {
    "email": "anonymous@example.com",
    "display_name": "Anonymous",
    "password": "Valid-Passw0rd!",
}


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/auth/register",
        "/api/v1/auth/register/",
        "/api/v1/auth/signup",
        "/api/v1/auth/users",
    ],
)
async def test_an_anonymous_caller_cannot_create_an_account(path: str) -> None:
    """A complete, valid registration body creates nothing on any likely path.

    Asserted on the wire, after every middleware: 404 or 405 means no handler
    accepted the body, and neither can have reached the database.
    """
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as client:
        response = await client.post(path, json=REGISTRATION_PAYLOAD)

    assert response.status_code in {404, 405}


def test_no_auth_route_accepts_an_account_creation_body() -> None:
    """No route on the auth router takes `UserCreate`, whatever it is called.

    The schema stays in the codebase for `scripts/account.py`; a route that
    declared it as a body would be registration under another name.
    """
    creating_routes = [
        route.path
        for route in auth_router.routes
        if isinstance(route, APIRoute)
        and any(
            getattr(parameter.field_info.annotation, "__name__", "") == "UserCreate"
            for parameter in route.dependant.body_params
        )
    ]

    assert creating_routes == []


def test_the_published_api_does_not_describe_account_creation() -> None:
    """The OpenAPI document names neither the route nor its request model."""
    document = app.openapi()

    assert "/api/v1/auth/register" not in document["paths"]
    assert "UserCreate" not in document["components"]["schemas"]
