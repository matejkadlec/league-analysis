"""Runtime control registry for pause/resume/stop operations on jobs."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass


@dataclass
class RuntimeJobControl:
    """In-memory runtime control flags for a currently running job."""

    task: asyncio.Task[None] | None = None
    stop_requested: bool = False
    force_stop_requested: bool = False
    paused: bool = False


_runtime_controls: dict[int, RuntimeJobControl] = {}


def runtime_control_key(job_config_id: int, *, test_run: bool = False) -> int:
    """The registry key for a run: test runs use the negated config ID.

    This is the one place the convention lives; every pause/stop/status
    path derives its key here so none of them can target the wrong run.
    """
    return -job_config_id if test_run else job_config_id


def claim_runtime_control(
    job_config_id: int,
    task: asyncio.Task[None] | None,
) -> bool:
    """Take the key for a run, or report that another run already holds it.

    Check and set with no `await` between them, so a single event loop makes
    this the mutual exclusion the callers assumed they had. Registering
    unconditionally after an awaited check let two runs of one configuration
    both start: the second overwrote the first's control, so stop requests
    reached only one of them and the first to finish unregistered the other's
    key -- after which the next run declared the live execution orphaned.

    Returns:
        bool: True when the key was free and is now held by this run.
    """
    if job_config_id in _runtime_controls:
        return False
    _runtime_controls[job_config_id] = RuntimeJobControl(task=task)
    return True


def unregister_runtime_control(job_config_id: int) -> None:
    """Remove runtime control object once a job is no longer running."""
    _runtime_controls.pop(job_config_id, None)


def set_runtime_job_paused(job_config_id: int, paused: bool) -> bool:
    """Pause or resume one run. Registry-scoped, so the flag dies with the run.

    Returns:
        bool: True when runtime control exists and the flag was applied.
    """
    control = _runtime_controls.get(job_config_id)
    if control is None:
        return False
    control.paused = paused
    return True


def is_runtime_job_running(job_config_id: int) -> bool:
    """Return True if runtime control exists for the given job configuration."""
    return job_config_id in _runtime_controls


def request_job_stop(job_config_id: int, force: bool = False) -> bool:
    """Request graceful or forced stop for a running job.

    Returns:
        bool: True when runtime control exists and request was applied.
    """
    control = _runtime_controls.get(job_config_id)
    if control is None:
        return False

    control.stop_requested = True
    # A stopping run is no longer paused: leaving the flag set makes the
    # control snapshot report paused-and-stopping, and the job card's
    # paused-first precedence would show "Resume" for a run already exiting.
    control.paused = False
    if force:
        control.force_stop_requested = True
        if control.task and not control.task.done():
            control.task.cancel("Forced stop requested")

    return True


def get_runtime_control_snapshot(job_config_id: int) -> dict[str, bool]:
    """Return runtime control flags for a job configuration."""
    control = _runtime_controls.get(job_config_id)
    if control is None:
        return {
            "is_running": False,
            "is_paused": False,
            "stop_requested": False,
            "force_stop_requested": False,
        }

    return {
        "is_running": True,
        "is_paused": control.paused,
        "stop_requested": control.stop_requested,
        "force_stop_requested": control.force_stop_requested,
    }
