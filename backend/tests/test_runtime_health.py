"""Runtime liveness and database-readiness contracts."""

from contextlib import asynccontextmanager
from json import loads
from types import SimpleNamespace

import pytest
from fastapi import Response
from starlette import status
from starlette.responses import JSONResponse

from app import main as app_main
from app.core import database as database_module


def test_database_pool_pre_pings_before_reusing_connections(monkeypatch) -> None:
    engine = object()
    engine_arguments: dict[str, object] = {}

    def create_engine(database_url: str, **kwargs: object) -> object:
        engine_arguments["database_url"] = database_url
        engine_arguments.update(kwargs)
        return engine

    monkeypatch.setattr(database_module, "create_async_engine", create_engine)
    monkeypatch.setattr(
        database_module,
        "async_sessionmaker",
        lambda *_args, **_kwargs: object(),
    )
    monkeypatch.setattr(
        database_module,
        "get_global_settings",
        lambda: SimpleNamespace(
            database_url="postgresql+asyncpg://local-test",
            debug=False,
        ),
    )

    manager = database_module.DatabaseManager()

    assert manager.engine is engine
    assert engine_arguments == {
        "database_url": "postgresql+asyncpg://local-test",
        "echo": False,
        "future": True,
        "pool_pre_ping": True,
    }


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
