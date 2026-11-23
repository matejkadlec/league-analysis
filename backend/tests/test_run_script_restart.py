"""`run.sh` across a restart: what is left of the previous backend.

The launcher used to stop only what still listened on the backend port. A
uvicorn worker closes its listener first and can keep working, so it outlived
every restart. These run the real script against stand-in commands.
"""

import contextlib
import os
import signal
import subprocess
import time
from collections.abc import Iterator
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
DEADLINE_SECONDS = 20

pytestmark = pytest.mark.skipif(
    not Path("/proc/self/environ").exists(),
    reason="run.sh finds its backend through /proc, which only Linux has",
)

# `uv run uvicorn ...` is the backend: a wrapper that dies on TERM and a
# worker that ignores it, as one draining a Riot run effectively did.
UV_STUB = """#!/bin/bash
if [ "$2" != "uvicorn" ]; then
    exit 0
fi
(trap '' TERM; echo "$BASHPID" >> "$LGA_TEST_RECORD"; exec sleep 300) &
echo "$$" >> "$LGA_TEST_RECORD"
exec sleep 300
"""
STUBS = {
    "uv": UV_STUB,
    "npm": "#!/bin/bash\nexec sleep 300\n",
    "psql": "#!/bin/bash\nexit 0\n",
    "curl": "#!/bin/bash\nexit 0\n",
    "ps": "#!/bin/bash\nexit 0\n",
    "ss": "#!/bin/bash\nexit 0\n",
    "lsof": "#!/bin/bash\nexit 1\n",
}


def _is_alive(pid: int) -> bool:
    """Whether a process still runs; a zombie waiting to be reaped does not."""
    try:
        stat = Path(f"/proc/{pid}/stat").read_text()
    except OSError:
        return False
    return stat.rsplit(")", 1)[1].split()[0] != "Z"


def _survivors(pids: list[int]) -> list[int]:
    """The processes still alive once the deadline for stopping has passed."""
    deadline = time.monotonic() + DEADLINE_SECONDS
    alive = pids
    while alive and time.monotonic() < deadline:
        time.sleep(0.1)
        alive = [pid for pid in alive if _is_alive(pid)]
    return alive


class _Launcher:
    """One checkout the real `run.sh` runs in, with every tool it calls stubbed."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.started: list[subprocess.Popen[bytes]] = []
        bin_directory = root / "bin"
        for directory in ("bin", "tools", "backend", "frontend/node_modules"):
            (root / directory).mkdir(parents=True)
        for name, body in STUBS.items():
            stub = bin_directory / name
            stub.write_text(body)
            stub.chmod(0o755)
        (root / "tools" / "use-project-node.sh").write_text("")
        (root / "run.sh").write_bytes((REPO_ROOT / "run.sh").read_bytes())

    def start(self) -> list[int]:
        """Run the launcher and return the PIDs of the backend it started."""
        record = self.root / f"backend-{len(self.started)}.pids"
        environment = {
            **os.environ,
            "PATH": f"{self.root / 'bin'}{os.pathsep}{os.environ['PATH']}",
            "LGA_TEST_RECORD": str(record),
            "LGA_RUN_BACKEND_STOP_TIMEOUT": "1",
        }
        with (self.root / "launcher.log").open("ab") as log:
            self.started.append(
                subprocess.Popen(
                    ["bash", "run.sh", "3999", "8999"],
                    cwd=self.root,
                    env=environment,
                    stdout=log,
                    stderr=subprocess.STDOUT,
                    start_new_session=True,
                )
            )
        deadline = time.monotonic() + DEADLINE_SECONDS
        while time.monotonic() < deadline:
            if record.exists() and len(record.read_text().split()) == 2:
                return [int(pid) for pid in record.read_text().split()]
            time.sleep(0.05)
        raise AssertionError((self.root / "launcher.log").read_text())

    def stop_everything(self) -> None:
        """Kill each launcher's whole process group, stand-ins included."""
        for process in self.started:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGKILL)
            process.wait()


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
    previous_backend = launcher.start()
    launcher.started[0].kill()

    launcher.start()

    assert _survivors(previous_backend) == []


def test_stopping_the_launcher_stops_a_worker_that_ignores_term(
    launcher: _Launcher,
) -> None:
    """Ctrl+C has to leave nothing behind either, however the worker behaves.

    The launcher signalled only the wrapper it had started, and reported all
    services stopped while that wrapper's worker was still running.
    """
    backend = launcher.start()

    os.killpg(launcher.started[0].pid, signal.SIGTERM)

    assert launcher.started[0].wait(timeout=DEADLINE_SECONDS) == 0
    assert _survivors(backend) == []


def test_a_superseded_launcher_leaves_its_successors_backend_running(
    launcher: _Launcher,
) -> None:
    """An old launcher exits when its backend is replaced; it stops only its own.

    Both backends serve the same checkout and port, so an exit that stopped
    "the backend" took the new one down seconds after it had started.
    """
    launcher.start()
    current_backend = launcher.start()

    os.killpg(launcher.started[0].pid, signal.SIGTERM)

    assert launcher.started[0].wait(timeout=DEADLINE_SECONDS) == 0
    assert [pid for pid in current_backend if not _is_alive(pid)] == []
