"""Job work that outlives its request, owned by the job runtime.

Starlette `BackgroundTasks` run inside the request, and uvicorn drains every
request before it shuts the application down, so a Riot run started there
keeps a stopped server alive. Work started here belongs to the process instead.
"""

import asyncio
from collections.abc import Callable, Coroutine
from typing import Any

import structlog

from .control import running_job_tasks

logger = structlog.get_logger(__name__)

# How long shutdown waits for cancelled runs to record their terminal state.
# One completion write each; startup recovery closes whatever outlasts it.
JOB_SHUTDOWN_TIMEOUT_SECONDS = 5.0

_runtime_tasks: set[asyncio.Task[None]] = set()


def _forget_runtime_task(task: asyncio.Task[None]) -> None:
    """Drop a finished task and report a failure nothing else would surface."""
    _runtime_tasks.discard(task)
    if task.cancelled():
        return
    error = task.exception()
    if error is not None:
        logger.error(
            "job_runtime_task_failed",
            task_name=task.get_name(),
            error_type=type(error).__name__,
        )


def start_runtime_task[**P](
    work: Callable[P, Coroutine[Any, Any, None]],
    *args: P.args,
    **kwargs: P.kwargs,
) -> asyncio.Task[None]:
    """Start `work` as a task that shutdown cancels and no request waits for."""
    name = getattr(work, "__qualname__", "job-runtime-task")
    task = asyncio.create_task(work(*args, **kwargs), name=name)
    _runtime_tasks.add(task)
    task.add_done_callback(_forget_runtime_task)
    return task


async def cancel_runtime_tasks(
    timeout_seconds: float = JOB_SHUTDOWN_TIMEOUT_SECONDS,
) -> None:
    """Cancel every running job and wait, bounded, for each to close its row.

    Covers the tasks started here and the scheduler-dispatched runs holding a
    runtime key, so no run is still writing when the process exits.
    """
    tasks = {task for task in _runtime_tasks | running_job_tasks() if not task.done()}
    if not tasks:
        return

    for task in tasks:
        # A run the scheduler or an operator already cancelled is writing its
        # terminal row; a second cancel would interrupt exactly that write.
        if not task.cancelling():
            task.cancel("Application shutdown")
    _, unfinished = await asyncio.wait(tasks, timeout=timeout_seconds)
    logger.info(
        "job_runtime_tasks_cancelled",
        cancelled=len(tasks) - len(unfinished),
        unfinished=len(unfinished),
    )
