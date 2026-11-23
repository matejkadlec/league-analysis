"""A checkout the real local scripts run in, with every command they call stubbed.

The stand-ins answer with the repository's own pins, and PATH holds nothing
else but a few system utilities, so a command a test removes is really gone.
"""

import contextlib
import json
import os
import re
import shutil
import signal
import subprocess
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DEADLINE_SECONDS = 20
# Below pytest's own 60 s timeout, which ends the whole run rather than the test.
RUN_TIMEOUT_SECONDS = 30
COPIED_FILES = (
    "run.sh",
    "test.sh",
    "tools/preflight.sh",
    "tools/use-project-node.sh",
    ".nvmrc",
    ".python-version",
    "compose.gate.yml",
    "frontend/package.json",
)
SYSTEM_UTILITIES = (
    "awk",
    "bash",
    "cat",
    "cut",
    "dirname",
    "grep",
    "head",
    "mkdir",
    "sed",
    "sleep",
    "tail",
    "tr",
)
PINNED_NODE = (REPO_ROOT / ".nvmrc").read_text().strip()
PINNED_NPM = str(
    json.loads((REPO_ROOT / "frontend" / "package.json").read_text())["packageManager"]
).removeprefix("npm@")

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


def pinned_postgres_major() -> int:
    """The PostgreSQL major version the gate's database image runs."""
    match = re.search(
        r"^\s*image:\s*postgres:(\d+)",
        (REPO_ROOT / "compose.gate.yml").read_text(),
        re.MULTILINE,
    )
    assert match is not None, "compose.gate.yml names no postgres image"
    return int(match.group(1))


def is_alive(pid: int) -> bool:
    """Whether a process still runs; a zombie waiting to be reaped does not."""
    try:
        stat = Path(f"/proc/{pid}/stat").read_text()
    except OSError:
        return False
    return stat.rsplit(")", 1)[1].split()[0] != "Z"


def survivors(pids: list[int]) -> list[int]:
    """The processes still alive once the deadline for stopping has passed."""
    deadline = time.monotonic() + DEADLINE_SECONDS
    alive = pids
    while alive and time.monotonic() < deadline:
        time.sleep(0.1)
        alive = [pid for pid in alive if is_alive(pid)]
    return alive


class ScriptSandbox:
    """One disposable checkout with stubbed tools and a closed PATH."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.bin = root / "bin"
        self.started: list[subprocess.Popen[bytes]] = []
        for directory in ("bin", "system", "tools", "backend", "frontend/node_modules"):
            (root / directory).mkdir(parents=True, exist_ok=True)
        for relative in COPIED_FILES:
            shutil.copyfile(REPO_ROOT / relative, root / relative)
        for utility in SYSTEM_UTILITIES:
            located = shutil.which(utility)
            assert located is not None, f"{utility} is needed to run the scripts"
            (root / "system" / utility).symlink_to(located)
        (root / ".env").write_text(
            "POSTGRES_DB=league_analysis_sandbox\n"
            "POSTGRES_USER=league_analysis_sandbox\n"
            "POSTGRES_PASSWORD=not-a-secret\n"
            "POSTGRES_HOST=127.0.0.1\n"
            "POSTGRES_PORT=5432\n"
        )
        server_version = pinned_postgres_major() * 10000 + 6
        stubs = {
            "uv": UV_STUB,
            "node": f'#!/bin/bash\necho "v{PINNED_NODE}"\n',
            "npm": (
                "#!/bin/bash\n"
                f'if [ "$1" = "--version" ]; then echo "{PINNED_NPM}"; exit 0; fi\n'
                "exec sleep 300\n"
            ),
            "psql": f"#!/bin/bash\necho {server_version}\n",
            "pg_dump": "#!/bin/bash\nexit 0\n",
            "pg_restore": "#!/bin/bash\nexit 0\n",
            "curl": "#!/bin/bash\nexit 0\n",
            "ps": "#!/bin/bash\nexit 0\n",
            "ss": "#!/bin/bash\nexit 0\n",
            "lsof": "#!/bin/bash\nexit 1\n",
        }
        for name, body in stubs.items():
            self.stub(name, body)

    @property
    def backend_record(self) -> Path:
        """Where the backend stand-in of a `run` writes the PIDs it started."""
        return self.root / "backend.pids"

    def stub(self, name: str, body: str) -> None:
        """Install or replace the stand-in for one command."""
        path = self.bin / name
        path.write_text(body)
        path.chmod(0o755)

    def remove(self, name: str) -> None:
        """Take a command off PATH entirely."""
        (self.bin / name).unlink()

    def install_wrong_node(self, manager: str) -> None:
        """Make another Node active and give `manager` no copy of the pinned one."""
        self.stub("node", '#!/bin/bash\necho "v1.0.0"\n')
        if manager == "nvm":
            (self.root / "nvm").mkdir()
            (self.root / "nvm" / "nvm.sh").write_text("nvm() { return 3; }\n")
        else:
            self.stub("fnm", "#!/bin/bash\nexit 1\n")

    def environment(self, record: Path) -> dict[str, str]:
        """A closed environment: the stand-ins, the utilities, and no profile."""
        return {
            "PATH": f"{self.bin}{os.pathsep}{self.root / 'system'}",
            "HOME": str(self.root),
            "NVM_DIR": str(self.root / "nvm"),
            "FNM_DIR": str(self.root / "fnm"),
            "LGA_TEST_RECORD": str(record),
            "LGA_RUN_BACKEND_STOP_TIMEOUT": "1",
        }

    def run(self, *command: str) -> subprocess.CompletedProcess[str]:
        """Run a command to completion and return its combined output."""
        process = subprocess.Popen(
            command,
            cwd=self.root,
            env=self.environment(self.backend_record),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            start_new_session=True,
        )
        try:
            output, _ = process.communicate(timeout=RUN_TIMEOUT_SECONDS)
        finally:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGKILL)
        return subprocess.CompletedProcess(command, process.returncode, output)

    def start(self, record: Path, *command: str) -> subprocess.Popen[bytes]:
        """Start a long-running command whose process group `stop_everything` ends."""
        with (self.root / "launcher.log").open("ab") as log:
            process = subprocess.Popen(
                command,
                cwd=self.root,
                env=self.environment(record),
                stdout=log,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
        self.started.append(process)
        return process

    def backend_pids(self, record: Path | None = None) -> list[int]:
        """The backend PIDs the stand-in recorded; none when it never started."""
        path = self.backend_record if record is None else record
        if not path.exists():
            return []
        return [int(pid) for pid in path.read_text().split()]

    def stop_everything(self) -> None:
        """Kill each started command's whole process group, stand-ins included."""
        for process in self.started:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGKILL)
            process.wait()
