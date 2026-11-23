"""A stopping server must not wait for the job a request started.

Uvicorn drains every request before it shuts the application down, so only a
real server shows whether a manual run still rides on its request. No
graceful timeout is set here: the exit has to come from the job runtime.
"""

from __future__ import annotations

import asyncio
import socket
from collections.abc import AsyncIterator, Iterator
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import cast, override
from unittest.mock import AsyncMock

import httpx
import pytest
import uvicorn

from app import main as main_module
from app.features.auth.dependencies import get_current_admin_user
from app.features.auth.users.models import User
from app.features.jobs import router as router_module
from app.features.jobs.base import BaseJob
from app.features.jobs.dependencies import get_job_service
from app.features.jobs.models import JobType
from app.features.jobs.schemas import JobConfigurationResponse
from app.features.jobs.service import JobService

pytestmark = [pytest.mark.integration, pytest.mark.enable_socket]

JOB_ID = 7
EXIT_DEADLINE_SECONDS = 10


class _LongRun:
    """Stands in for a Riot run: works until cancelled, and says so."""

    def __init__(self) -> None:
        self.started = asyncio.Event()
        self.cancelled = False

    async def run(self) -> None:
        self.started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            self.cancelled = True
            raise


class _SignallingServer(uvicorn.Server):
    """A uvicorn server that says when it has started accepting connections."""

    def __init__(self, config: uvicorn.Config) -> None:
        super().__init__(config)
        self.accepting = asyncio.Event()

    @override
    async def startup(self, sockets: list[socket.socket] | None = None) -> None:
        await super().startup(sockets=sockets)
        self.accepting.set()


class _ServiceDouble:
    """Answers the two lookups the trigger route makes."""

    async def get_job_configuration(self, job_id: int) -> JobConfigurationResponse:
        return JobConfigurationResponse(
            id=job_id,
            job_type=JobType.MATCH_FETCHER,
            name="Match Fetcher",
            description=None,
            schedule="900",
            is_active=True,
            config_json={},
            created_at=datetime(2026, 1, 1, tzinfo=UTC),
            updated_at=datetime(2026, 1, 1, tzinfo=UTC),
        )

    async def is_job_running(self, _job_type: JobType) -> bool:
        return False


@pytest.fixture
def long_run(monkeypatch: pytest.MonkeyPatch) -> Iterator[_LongRun]:
    """The application with its database and scheduler out of the picture."""
    run = _LongRun()
    monkeypatch.setattr(main_module, "_start_scheduler_safely", AsyncMock())
    monkeypatch.setattr(main_module, "shutdown_scheduler", lambda: None)

    def build_job(
        _job: JobConfigurationResponse, triggered_by: str = "system"
    ) -> BaseJob:
        return cast(BaseJob, run)

    monkeypatch.setattr(router_module, "_create_job_instance", build_job)
    overrides = main_module.app.dependency_overrides
    overrides[get_current_admin_user] = lambda: cast(User, SimpleNamespace(id=1))
    overrides[get_job_service] = lambda: cast(JobService, _ServiceDouble())
    yield run
    overrides.clear()


@pytest.fixture
async def running_server() -> AsyncIterator[tuple[uvicorn.Server, asyncio.Task[None]]]:
    """The real application behind a real uvicorn server on a free port."""
    server = _SignallingServer(
        uvicorn.Config(main_module.app, host="127.0.0.1", port=0, log_level="warning")
    )
    serving = asyncio.create_task(server.serve())
    await asyncio.wait_for(server.accepting.wait(), timeout=EXIT_DEADLINE_SECONDS)
    yield server, serving
    server.force_exit = True
    server.should_exit = True
    serving.cancel()
    await asyncio.gather(serving, return_exceptions=True)


async def test_a_stopping_server_does_not_wait_for_a_manually_triggered_job(
    long_run: _LongRun,
    running_server: tuple[uvicorn.Server, asyncio.Task[None]],
) -> None:
    """Shutdown ends the run; the run does not postpone the shutdown.

    Started as a request's background task, the run kept the process alive
    after its port closed, fetching while a new backend cancelled its row.
    """
    server, serving = running_server
    port = server.servers[0].sockets[0].getsockname()[1]

    # `trust_env=False`: a proxy from the environment must not see loopback.
    async with httpx.AsyncClient(trust_env=False) as client:
        response = await client.post(
            f"http://127.0.0.1:{port}/api/v1/jobs/{JOB_ID}/trigger"
        )
    assert response.status_code == 200
    assert response.json()["success"] is True
    await asyncio.wait_for(long_run.started.wait(), timeout=EXIT_DEADLINE_SECONDS)

    server.should_exit = True
    await asyncio.wait_for(asyncio.shield(serving), timeout=EXIT_DEADLINE_SECONDS)

    assert long_run.cancelled is True
