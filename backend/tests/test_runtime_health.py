"""Runtime liveness and database-readiness contracts."""

from contextlib import asynccontextmanager
from json import loads

import pytest
from fastapi import Response
from starlette import status
from starlette.responses import JSONResponse

from app import main as app_main


@pytest.mark.asyncio
async def test_readiness_requires_a_database_round_trip(monkeypatch) -> None:
    class Session:
        async def execute(self, statement: object) -> None:
            assert str(statement) == "SELECT 1"

    @asynccontextmanager
    async def get_session():
        yield Session()

    monkeypatch.setattr(app_main.db_manager, "get_session", get_session)
    response = Response()

    result = await app_main.readiness_check(response)

    assert result == {"status": "ready", "database": "ready"}
    assert response.status_code == status.HTTP_200_OK


@pytest.mark.asyncio
async def test_readiness_fails_closed_without_leaking_database_errors(
    monkeypatch,
) -> None:
    @asynccontextmanager
    async def get_session():
        raise RuntimeError("private database detail")
        yield

    monkeypatch.setattr(app_main.db_manager, "get_session", get_session)

    result = await app_main.readiness_check(Response())

    assert isinstance(result, JSONResponse)
    assert result.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
    assert loads(result.body) == {
        "status": "unavailable",
        "database": "unavailable",
    }
    assert b"private database detail" not in result.body
