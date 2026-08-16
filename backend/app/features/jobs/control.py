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


_runtime_controls: dict[int, RuntimeJobControl] = {}


def register_runtime_control(
    job_config_id: int,
    task: asyncio.Task[None] | None,
) -> None:
    """Register runtime control object for a running job."""
    _runtime_controls[job_config_id] = RuntimeJobControl(task=task)


def unregister_runtime_control(job_config_id: int) -> None:
    """Remove runtime control object once a job is no longer running."""
    _runtime_controls.pop(job_config_id, None)


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
            "stop_requested": False,
            "force_stop_requested": False,
        }

    return {
        "is_running": True,
        "stop_requested": control.stop_requested,
        "force_stop_requested": control.force_stop_requested,
    }
