"""Tests for the guarded one-way Pi-to-local PostgreSQL mirror."""

from __future__ import annotations

import importlib.util
import json
import os
import stat
import subprocess
import sys
from pathlib import Path
from types import ModuleType

import pytest

SCRIPT_PATH = (
    Path(__file__).resolve().parents[1] / "scripts" / "mirror_pi_postgres_to_local.py"
)


def load_script() -> ModuleType:
    """Load the standalone installed-script-compatible module."""
    spec = importlib.util.spec_from_file_location(
        "mirror_pi_postgres_to_local", SCRIPT_PATH
    )
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def mirror() -> ModuleType:
    """Return the loaded mirror module."""
    return load_script()


@pytest.fixture
def local_config(mirror: ModuleType) -> object:
    """A local target that satisfies the mirror contract."""
    return mirror.LocalDatabaseConfig(
        database=mirror.LOCAL_DATABASE,
        user="admin",
        password="opaque-test-value",
        host="127.0.0.1",
        port=5432,
        environment="dev",
    )


@pytest.fixture
def mirror_paths(mirror: ModuleType, tmp_path: Path) -> object:
    """Every mirror path pointed at a throwaway directory."""
    return mirror.MirrorPaths(
        root=tmp_path,
        state_directory=tmp_path,
        state_file=tmp_path / "state",
        lock_file=tmp_path / "lock",
        snapshot_sql=tmp_path / "snapshot.sql",
    )


@pytest.mark.parametrize(
    "value",
    ["localhost", "127.0.0.1", "127.0.0.1/32", "::1", "[::1]"],
)
def test_loopback_addresses_are_accepted(mirror: ModuleType, value: str) -> None:
    assert mirror.is_loopback_address(value)


@pytest.mark.parametrize("value", ["0.0.0.0", "192.168.1.20", "postgres", "*"])
def test_non_loopback_addresses_are_rejected(mirror: ModuleType, value: str) -> None:
    assert not mirror.is_loopback_address(value)


@pytest.mark.parametrize(
    "value",
    [
        # The forms the two case lists above already cover, plus the ones a
        # divergence has actually slipped through before (127.0.0.2) and the
        # spellings only one side used to accept.
        "localhost",
        "LOCALHOST ",
        "127.0.0.1",
        "127.0.0.2",
        "127.0.0.1/32",
        "::1",
        "::1/128",
        "[::1]",
        "::ffff:127.0.0.1",
        "0.0.0.0",
        "0.0.0.0/0",
        "10.0.0.8",
        "192.168.1.2",
        "db.internal",
        "*",
        "",
    ],
)
def test_the_private_copy_agrees_with_local_target(
    mirror: ModuleType, value: str
) -> None:
    """The mirror keeps its own `is_loopback_address` on purpose -- the
    installer ships this one file with no repository on `sys.path` -- and both
    copies guard a destructive operation. 'Keep the two in step' was prose
    until now; this holds their verdicts equal over every reviewed form."""
    from scripts.local_target import is_loopback_address

    assert mirror.is_loopback_address(value) == is_loopback_address(value)


def test_dotenv_parser_preserves_secret_characters(mirror: ModuleType) -> None:
    values = mirror.parse_dotenv_lines(
        [
            "# private configuration",
            "POSTGRES_PASSWORD='opaque # value != still secret'",
            'export POSTGRES_HOST="127.0.0.1"',
        ]
    )

    assert values == {
        "POSTGRES_PASSWORD": "opaque # value != still secret",
        "POSTGRES_HOST": "127.0.0.1",
    }


def test_invalid_dotenv_line_is_refused(mirror: ModuleType) -> None:
    with pytest.raises(mirror.MirrorRefusal, match="invalid line"):
        mirror.parse_dotenv_lines(["not a configuration line"])


def test_private_configuration_must_be_mode_0600(
    mirror: ModuleType, tmp_path: Path
) -> None:
    config_path = tmp_path / ".env"
    config_path.write_text(
        "\n".join(
            (
                "POSTGRES_DB=league_analysis_local_dev",
                "POSTGRES_USER=admin",
                "POSTGRES_PASSWORD=opaque-test-value",
                "POSTGRES_HOST=127.0.0.1",
                "POSTGRES_PORT=5432",
                "ENVIRONMENT=dev",
            )
        ),
        encoding="utf-8",
    )
    config_path.chmod(0o644)

    with pytest.raises(mirror.MirrorRefusal, match="mode 0600"):
        mirror.load_local_config(config_path, mirror.LOCAL_DATABASE)


def test_private_configuration_loads_without_exporting_password(
    mirror: ModuleType, tmp_path: Path
) -> None:
    config_path = tmp_path / ".env"
    config_path.write_text(
        "\n".join(
            (
                "POSTGRES_DB=league_analysis_local_dev",
                "POSTGRES_USER=admin",
                "POSTGRES_PASSWORD=opaque-test-value",
                "POSTGRES_HOST=127.0.0.1",
                "POSTGRES_PORT=5432",
                "ENVIRONMENT=dev",
            )
        ),
        encoding="utf-8",
    )
    config_path.chmod(0o600)

    config = mirror.load_local_config(config_path, mirror.LOCAL_DATABASE)

    assert config.database == mirror.LOCAL_DATABASE
    assert config.host == "127.0.0.1"
    assert os.environ.get("PGPASSWORD") != "opaque-test-value"


def test_remote_operation_supports_both_reviewed_helper_layouts(
    mirror: ModuleType,
) -> None:
    command = mirror.remote_operation_command(
        "snapshot", "--confirm-target", mirror.REMOTE_DATABASE
    )

    assert (
        '"$HOME/.local/share/league-analysis/current/backup/'
        'pi-postgres-operations.sh"' in command
    )
    assert (
        '"$HOME/.local/share/league-analysis/operations/pi-postgres-operations"'
        in command
    )
    assert "snapshot --confirm-target league_analysis" in command


def test_remote_source_accepts_matching_schema_without_legacy_authority_marker(
    mirror: ModuleType, monkeypatch: pytest.MonkeyPatch
) -> None:
    identity = (
        "container=league-analysis-postgres compose_project=league-analysis "
        "compose_service=postgres database=league_analysis "
        "postgres=18.4 (Debian) alembic=20260813_0010 host_ports=none"
    )

    def remote_identity(_host: str) -> str:
        return identity

    monkeypatch.setattr(mirror, "remote_identity", remote_identity)

    assert (
        mirror.verify_remote_source(
            mirror.REMOTE_HOST, mirror.REMOTE_DATABASE, "20260813_0010"
        )
        == identity
    )


def test_remote_source_refuses_schema_mismatch_before_mirroring(
    mirror: ModuleType, monkeypatch: pytest.MonkeyPatch
) -> None:
    identity = (
        "container=league-analysis-postgres compose_project=league-analysis "
        "compose_service=postgres database=league_analysis "
        "postgres=18.4 (Debian) alembic=20260814_0011 host_ports=none"
    )

    def remote_identity(_host: str) -> str:
        return identity

    monkeypatch.setattr(mirror, "remote_identity", remote_identity)

    with pytest.raises(mirror.MirrorRefusal, match="Alembic heads differ"):
        mirror.verify_remote_source(
            mirror.REMOTE_HOST, mirror.REMOTE_DATABASE, "20260813_0010"
        )


@pytest.mark.parametrize(
    ("phase", "target", "stage", "rollback", "expected"),
    [
        ("staging", True, True, False, "discard_stage"),
        ("swapping", False, True, True, "restore_rollback"),
        ("validating", True, False, True, "restore_rollback"),
        ("committing", True, False, False, "accept_committed"),
    ],
)
def test_recovery_classification_is_failure_safe(
    mirror: ModuleType,
    phase: str,
    target: bool,
    stage: bool,
    rollback: bool,
    expected: str,
) -> None:
    assert (
        mirror.classify_recovery(
            phase,
            target_exists=target,
            stage_exists=stage,
            rollback_exists=rollback,
        )
        == expected
    )


def test_ambiguous_recovery_is_refused(mirror: ModuleType) -> None:
    with pytest.raises(mirror.MirrorRefusal, match="ambiguous"):
        mirror.classify_recovery(
            "swapping", target_exists=False, stage_exists=False, rollback_exists=False
        )


def test_state_file_is_private_and_validated(
    mirror: ModuleType, tmp_path: Path
) -> None:
    state_path = tmp_path / "replacement.state"
    payload = mirror.state_payload(
        "staging",
        mirror.LOCAL_DATABASE,
        "league_analysis_local_dev_mirror_stage_20260810t120000",
        "league_analysis_local_dev_mirror_rollback_20260810t120000",
        "a" * 64,
    )

    mirror.write_state(state_path, payload)

    assert stat.S_IMODE(state_path.stat().st_mode) == 0o600
    assert mirror.read_state(state_path) == payload
    serialized = json.loads(state_path.read_text(encoding="utf-8"))
    assert "password" not in serialized


def test_failed_remote_download_removes_partial_archive(
    mirror: ModuleType, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    archive = tmp_path / "pi-source.dump"

    def fail_remote(*_args: object, **_kwargs: object) -> None:
        raise subprocess.CalledProcessError(42, ["ssh", mirror.REMOTE_HOST])

    monkeypatch.setattr(mirror.subprocess, "run", fail_remote)

    with pytest.raises(subprocess.CalledProcessError):
        mirror.download_remote_archive(
            mirror.REMOTE_HOST, mirror.REMOTE_DATABASE, archive
        )
    assert not archive.exists()


def test_drop_database_refuses_unrelated_name(
    mirror: ModuleType, local_config: object
) -> None:
    with pytest.raises(mirror.MirrorRefusal, match="outside the mirror contract"):
        mirror.drop_database(local_config, "another_project")


def test_matching_snapshot_skips_full_mirror(
    mirror: ModuleType,
    monkeypatch: pytest.MonkeyPatch,
    local_config: object,
    mirror_paths: object,
) -> None:
    def identical_snapshot(*_args: object) -> str:
        return "same"

    monkeypatch.setattr(mirror, "remote_snapshot", identical_snapshot)
    monkeypatch.setattr(mirror, "psql_snapshot", identical_snapshot)

    def unexpected_mirror(*_args: object) -> None:
        raise AssertionError("matching snapshots must not trigger a full mirror")

    monkeypatch.setattr(mirror, "mirror", unexpected_mirror)

    assert not mirror.refresh_if_changed(
        local_config,
        mirror_paths,
        mirror.REMOTE_HOST,
        mirror.REMOTE_DATABASE,
        "20260813_0010",
    )


def test_changed_snapshot_runs_full_mirror(
    mirror: ModuleType,
    monkeypatch: pytest.MonkeyPatch,
    local_config: object,
    mirror_paths: object,
) -> None:
    calls: list[tuple[object, ...]] = []

    def source_snapshot(*_args: object) -> str:
        return "source"

    def local_snapshot(*_args: object) -> str:
        return "local"

    def record_mirror(*args: object) -> None:
        calls.append(args)

    monkeypatch.setattr(mirror, "remote_snapshot", source_snapshot)
    monkeypatch.setattr(mirror, "psql_snapshot", local_snapshot)
    monkeypatch.setattr(mirror, "mirror", record_mirror)

    assert mirror.refresh_if_changed(
        local_config,
        mirror_paths,
        mirror.REMOTE_HOST,
        mirror.REMOTE_DATABASE,
        "20260813_0010",
    )
    assert len(calls) == 1
