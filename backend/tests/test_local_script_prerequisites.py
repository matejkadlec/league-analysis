"""The local scripts name a wrong prerequisite and its fix instead of dying.

`run.sh` once ended right after "Backend is ready!" with no word when the
pinned Node was missing, and left its backend running. These run the real
scripts against stand-in commands in a closed sandbox.
"""

import subprocess
import sys
from collections.abc import Iterator
from pathlib import Path

import pytest
from script_sandbox import (
    PINNED_NODE,
    PINNED_NPM,
    REPO_ROOT,
    ScriptSandbox,
    pinned_postgres_major,
    survivors,
)

pytestmark = pytest.mark.skipif(
    not Path("/proc/self/environ").exists(),
    reason="run.sh finds its backend through /proc, which only Linux has",
)

MISSING_NODE = f"Node {PINNED_NODE} is required by .nvmrc but is not active"


@pytest.fixture
def sandbox(tmp_path: Path) -> Iterator[ScriptSandbox]:
    checkout = ScriptSandbox(tmp_path)
    yield checkout
    checkout.stop_everything()


def _launch(sandbox: ScriptSandbox) -> subprocess.CompletedProcess[str]:
    return sandbox.run("bash", "run.sh", "3999", "8999")


@pytest.mark.parametrize("manager", ["nvm", "fnm"])
@pytest.mark.parametrize("shell_options", ["set -e", "set -euo pipefail"])
def test_the_node_selector_explains_a_missing_version_to_a_strict_caller(
    sandbox: ScriptSandbox, manager: str, shell_options: str
) -> None:
    """Errexit used to end the caller inside `nvm use`, before the message."""
    sandbox.install_wrong_node(manager)

    result = sandbox.run(
        "bash", "-c", f"{shell_options}; source tools/use-project-node.sh; echo past"
    )

    assert result.returncode != 0
    assert MISSING_NODE in result.stdout
    assert f"{manager} install {PINNED_NODE}" in result.stdout
    assert "past" not in result.stdout


def test_run_sh_stops_on_a_wrong_node_before_starting_the_backend(
    sandbox: ScriptSandbox,
) -> None:
    sandbox.install_wrong_node("nvm")

    result = _launch(sandbox)

    assert result.returncode == 1
    assert MISSING_NODE in result.stdout
    assert sandbox.backend_pids() == []


def test_run_sh_names_a_missing_uv_before_starting_anything(
    sandbox: ScriptSandbox,
) -> None:
    sandbox.remove("uv")

    result = _launch(sandbox)

    assert result.returncode == 1
    assert "uv is required but was not found on PATH" in result.stdout
    assert "docs.astral.sh/uv" in result.stdout
    assert sandbox.backend_pids() == []


def test_run_sh_shows_why_postgresql_refused_the_connection(
    sandbox: ScriptSandbox,
) -> None:
    sandbox.stub(
        "psql",
        "#!/bin/bash\necho 'connection to server failed: Connection refused' >&2\n"
        "exit 2\n",
    )

    result = _launch(sandbox)

    assert result.returncode == 1
    assert "Cannot connect to PostgreSQL at 127.0.0.1:5432" in result.stdout
    assert "Connection refused" in result.stdout
    assert sandbox.backend_pids() == []


def test_run_sh_refuses_a_postgresql_server_of_another_major_version(
    sandbox: ScriptSandbox,
) -> None:
    pinned = pinned_postgres_major()
    sandbox.stub("psql", f"#!/bin/bash\necho {(pinned - 2) * 10000 + 4}\n")

    result = _launch(sandbox)

    assert result.returncode == 1
    assert f"PostgreSQL {pinned} is required" in result.stdout
    assert f"runs PostgreSQL {pinned - 2}" in result.stdout
    assert sandbox.backend_pids() == []


def test_a_late_failure_names_its_step_and_stops_the_started_backend(
    sandbox: ScriptSandbox,
) -> None:
    """A step failing after the backend is up must not end the run in silence.

    Before the EXIT trap, the backend outlived such a launcher, and the next
    run met it as an unexplained listener on its port.
    """
    (sandbox.root / "frontend" / "node_modules").rmdir()
    sandbox.stub(
        "npm",
        "#!/bin/bash\n"
        f'case "$1" in --version) echo "{PINNED_NPM}"; exit 0;; install) exit 7;; esac\n'
        "exec sleep 300\n",
    )

    result = _launch(sandbox)

    assert result.returncode == 7
    assert "failed while installing frontend dependencies" in result.stdout
    assert "npm install" in result.stdout
    backend = sandbox.backend_pids()
    assert len(backend) == 2
    assert survivors(backend) == []


def test_test_sh_stops_on_a_wrong_node_before_its_first_check(
    sandbox: ScriptSandbox,
) -> None:
    sandbox.install_wrong_node("fnm")

    result = sandbox.run("bash", "test.sh", "-f")

    assert result.returncode == 1
    assert MISSING_NODE in result.stdout
    assert "FAIL: Prerequisites" in result.stdout
    assert "Repository hygiene" not in result.stdout


def test_test_sh_names_a_missing_postgresql_client_before_its_first_check(
    sandbox: ScriptSandbox,
) -> None:
    sandbox.remove("pg_dump")

    result = sandbox.run("bash", "test.sh", "-b")

    assert result.returncode == 1
    assert "pg_dump is required but was not found on PATH" in result.stdout
    assert f"postgresql-client-{pinned_postgres_major()}" in result.stdout
    assert "Backend deterministic sync" not in result.stdout


def _check_validation_prerequisites(
    sandbox: ScriptSandbox, port: str
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "scripts/validate_migrations.py", "--prerequisites"],
        cwd=REPO_ROOT / "backend",
        env={
            "PATH": sandbox.environment(sandbox.backend_record)["PATH"],
            "POSTGRES_DB": "league_analysis_sandbox",
            "POSTGRES_USER": "league_analysis_sandbox",
            "POSTGRES_PASSWORD": "not-a-secret",
            "POSTGRES_HOST": "127.0.0.1",
            "POSTGRES_PORT": port,
            "DEBUG": "false",
            "ENVIRONMENT": "test",
            "JWT_SECRET_KEY": "league-analysis-test-jwt-secret-32-characters",
        },
        capture_output=True,
        text=True,
        check=False,
        timeout=60,
    )


def test_the_migration_validation_refuses_clients_of_another_major_version(
    sandbox: ScriptSandbox,
) -> None:
    pinned = pinned_postgres_major()
    for client in ("pg_dump", "pg_restore", "psql"):
        sandbox.stub(
            client, f"#!/bin/bash\necho '{client} (PostgreSQL) {pinned - 2}.4'\n"
        )

    result = _check_validation_prerequisites(sandbox, "5432")

    assert result.returncode == 1
    assert f"pg_dump must be PostgreSQL {pinned}" in result.stderr
    assert "POSTGRES_* from the environment, else from .env" in result.stderr


def test_the_migration_validation_names_an_unreachable_server_up_front(
    sandbox: ScriptSandbox,
) -> None:
    pinned = pinned_postgres_major()
    for client in ("pg_dump", "pg_restore", "psql"):
        sandbox.stub(client, f"#!/bin/bash\necho '{client} (PostgreSQL) {pinned}.6'\n")

    result = _check_validation_prerequisites(sandbox, "1")

    assert result.returncode == 1
    assert "PostgreSQL is not ready for the migration validation" in result.stderr
    assert '"127.0.0.1", port 1 failed' in result.stderr
