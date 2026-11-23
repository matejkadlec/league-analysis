"""Job work the runtime owns: what shutdown cancels, and how long it waits.

A run started inside a request keeps a stopped server alive, and one nothing
cancels keeps writing after its process was replaced. These tests pin both
halves: every running job is cancelled, and the wait for it is bounded.
"""

import asyncio
from unittest.mock import AsyncMock

import pytest

from app import main as main_module
from app.features.jobs import control as control_module
from app.features.jobs.runtime_tasks import cancel_runtime_tasks, start_runtime_task


class _Run:
    """A job run that works until cancelled, then records its terminal row."""

    def __init__(self) -> None:
        self.started = asyncio.Event()
        self.may_close_row = asyncio.Event()
        self.may_close_row.set()
        self.row_closed = False

    async def work(self) -> None:
        self.started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            await self.may_close_row.wait()
            self.row_closed = True


async def test_shutdown_cancels_a_running_job_and_waits_for_its_terminal_row() -> None:
    """Cancelling is half of it: the run needs a moment to write `CANCELLED`.

    Returning at once leaves the row `RUNNING` for the next start to clean up,
    while the process exits with the write still in flight.
    """
    run = _Run()
    task = start_runtime_task(run.work)
    await run.started.wait()

    await cancel_runtime_tasks(timeout_seconds=5)

    assert task.done()
    assert run.row_closed is True


async def test_shutdown_cancels_a_run_the_scheduler_dispatched() -> None:
    """A scheduled run is known only by its runtime key, and must stop too."""
    run = _Run()
    task = asyncio.create_task(run.work())
    control_module.claim_runtime_control(7, task)
    await run.started.wait()

    await cancel_runtime_tasks(timeout_seconds=5)

    assert task.done()
    assert run.row_closed is True


async def test_shutdown_does_not_wait_for_a_job_that_will_not_stop() -> None:
    """The wait is bounded: a stuck run must not hold the process open.

    An unbounded wait is the original defect by another route -- the server
    is gone and the old process is still there.
    """
    run = _Run()
    run.may_close_row.clear()
    task = start_runtime_task(run.work)
    await run.started.wait()

    await asyncio.wait_for(cancel_runtime_tasks(timeout_seconds=0.05), timeout=5)

    assert not task.done()
    run.may_close_row.set()
    await task


async def test_shutdown_leaves_a_run_alone_while_it_writes_its_terminal_row() -> None:
    """A run already cancelled is closing its row; a second cancel aborts that.

    The scheduler cancels its own runs first, so shutdown meets them exactly
    here, in the middle of the one write that matters.
    """
    run = _Run()
    run.may_close_row.clear()
    task = start_runtime_task(run.work)
    await run.started.wait()
    task.cancel()
    await asyncio.sleep(0)

    shutdown = asyncio.create_task(cancel_runtime_tasks(timeout_seconds=5))
    await asyncio.sleep(0)
    run.may_close_row.set()
    await shutdown

    assert task.done()
    assert run.row_closed is True


async def test_the_application_shutdown_stops_running_jobs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The lifespan is where a stopping server reaches its jobs.

    Without it a run started by a request outlives the application: nothing
    else cancels it before the event loop is torn down.
    """
    monkeypatch.setattr(main_module, "_start_scheduler_safely", AsyncMock())
    stopped: list[str] = []
    monkeypatch.setattr(
        main_module, "shutdown_scheduler", lambda: stopped.append("scheduler")
    )
    run = _Run()

    async with main_module.lifespan(main_module.app):
        task = start_runtime_task(run.work)
        await run.started.wait()

    assert stopped == ["scheduler"]
    assert task.done()
    assert run.row_closed is True
