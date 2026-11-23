"""`run.sh` across a restart: what is left of the previous backend.

The launcher used to stop only what still listened on the backend port. A
uvicorn worker closes its listener first and can keep working, so it outlived
every restart. These run the real script against stand-in commands.
"""

import os
import signal
import time
from collections.abc import Iterator
from pathlib import Path

import pytest
from script_sandbox import DEADLINE_SECONDS, ScriptSandbox, is_alive, survivors

pytestmark = pytest.mark.skipif(
    not Path("/proc/self/environ").exists(),
    reason="run.sh finds its backend through /proc, which only Linux has",
)


class _Launcher(ScriptSandbox):
    """One checkout the real `run.sh` runs in, started as often as a test needs."""

    def start_launcher(self) -> list[int]:
        """Run the launcher and return the PIDs of the backend it started."""
        record = self.root / f"backend-{len(self.started)}.pids"
        self.start(record, "bash", "run.sh", "3999", "8999")
        deadline = time.monotonic() + DEADLINE_SECONDS
        while time.monotonic() < deadline:
            if len(self.backend_pids(record)) == 2:
                return self.backend_pids(record)
            time.sleep(0.05)
        raise AssertionError((self.root / "launcher.log").read_text())


@pytest.fixture
def launcher(tmp_path: Path) -> Iterator[_Launcher]:
    sandbox = _Launcher(tmp_path)
    yield sandbox
    sandbox.stop_everything()


def test_a_restart_leaves_no_process_of_the_previous_backend_alive(
    launcher: _Launcher,
) -> None:
    """Starting again must end the whole previous backend, not free its port.

    The survivor is a second job runner on the same database and Riot key:
    it keeps fetching while the new backend cancels the run it works on.
    """
    previous_backend = launcher.start_launcher()
    launcher.started[0].kill()

    launcher.start_launcher()

    assert survivors(previous_backend) == []


def test_stopping_the_launcher_stops_a_worker_that_ignores_term(
    launcher: _Launcher,
) -> None:
    """Ctrl+C has to leave nothing behind either, however the worker behaves.

    The launcher signalled only the wrapper it had started, and reported all
    services stopped while that wrapper's worker was still running.
    """
    backend = launcher.start_launcher()

    os.killpg(launcher.started[0].pid, signal.SIGTERM)

    assert launcher.started[0].wait(timeout=DEADLINE_SECONDS) == 0
    assert survivors(backend) == []


def test_a_superseded_launcher_leaves_its_successors_backend_running(
    launcher: _Launcher,
) -> None:
    """An old launcher exits when its backend is replaced; it stops only its own.

    Both backends serve the same checkout and port, so an exit that stopped
    "the backend" took the new one down seconds after it had started.
    """
    launcher.start_launcher()
    current_backend = launcher.start_launcher()

    os.killpg(launcher.started[0].pid, signal.SIGTERM)

    assert launcher.started[0].wait(timeout=DEADLINE_SECONDS) == 0
    assert [pid for pid in current_backend if not is_alive(pid)] == []
