#!/usr/bin/env python3
"""Replace the disposable local database from a full read-only Pi snapshot."""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import ipaddress
import json
import os
import re
import shlex
import signal
import stat
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import NoReturn

LOCAL_DATABASE = "league_analysis_local_dev"
REMOTE_DATABASE = "league_analysis"
REMOTE_HOST = "pi5ram16"
REMOTE_SCRIPT_CANDIDATES = (
    "$HOME/.local/share/league-analysis/current/backup/pi-postgres-operations.sh",
    "$HOME/.local/share/league-analysis/operations/pi-postgres-operations",
)
DEFAULT_CONFIG = Path.home() / "projects" / "league-analysis" / ".env"
DEFAULT_OPERATION_ROOT = Path.home() / ".local" / "share" / "league-analysis"
ALEMBIC_HEAD_PATTERN = re.compile(r"^[0-9]{8}_[0-9]{4}$")
DATABASE_NAME_PATTERN = re.compile(r"^[a-z][a-z0-9_]{0,62}$")
GENERATED_NAME_PATTERN = re.compile(
    rf"^{LOCAL_DATABASE}_mirror_(?:stage|rollback)_[0-9]{{8}}t[0-9]{{6}}$"
)


class MirrorRefusal(RuntimeError):
    """Raised when a mirror safety or integrity prerequisite fails."""


@dataclass(frozen=True)
class LocalDatabaseConfig:
    """Secret-bearing local libpq configuration loaded from a private file."""

    database: str
    user: str
    password: str
    host: str
    port: int
    environment: str


@dataclass(frozen=True)
class MirrorPaths:
    """Persistent local paths used for locking and crash recovery."""

    root: Path
    state_directory: Path
    state_file: Path
    lock_file: Path
    snapshot_sql: Path


def parse_arguments(argv: list[str] | None = None) -> argparse.Namespace:
    """Parse the deliberately narrow mirror interface."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True, choices=(LOCAL_DATABASE,))
    parser.add_argument("--remote", default=REMOTE_HOST, choices=(REMOTE_HOST,))
    parser.add_argument(
        "--remote-database", default=REMOTE_DATABASE, choices=(REMOTE_DATABASE,)
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=Path(os.getenv("LGA_LOCAL_CONFIG", DEFAULT_CONFIG)),
        help="Private local .env path; values are never printed or passed on argv.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Download and atomically activate a complete Pi snapshot.",
    )
    return parser.parse_args(argv)


def is_loopback_address(value: str) -> bool:
    """Return whether a configured or observed address is loopback-only."""
    normalized = value.strip().strip("[]").lower()
    if normalized == "localhost":
        return True
    try:
        return ipaddress.ip_interface(normalized).ip.is_loopback
    except ValueError:
        return False


def parse_dotenv_lines(lines: list[str]) -> dict[str, str]:
    """Parse the repository's simple KEY=VALUE configuration shape."""
    values: dict[str, str] = {}
    for raw_line in lines:
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line.removeprefix("export ").lstrip()
        key, separator, raw_value = line.partition("=")
        key = key.strip()
        if not separator or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            raise MirrorRefusal("the private configuration contains an invalid line")
        value = raw_value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        values[key] = value
    return values


def load_local_config(path: Path, database: str) -> LocalDatabaseConfig:
    """Load local configuration only after private-file identity checks."""
    requested = path.expanduser()
    try:
        path_stat = requested.lstat()
    except FileNotFoundError as error:
        raise MirrorRefusal(
            "the private local configuration file is missing"
        ) from error
    if stat.S_ISLNK(path_stat.st_mode) or not stat.S_ISREG(path_stat.st_mode):
        raise MirrorRefusal("the private local configuration must be a regular file")
    if stat.S_IMODE(path_stat.st_mode) != 0o600 or path_stat.st_uid != os.geteuid():
        raise MirrorRefusal(
            "the private local configuration must be current-user-owned mode 0600"
        )
    resolved = requested.resolve(strict=True)
    values = parse_dotenv_lines(resolved.read_text(encoding="utf-8").splitlines())
    required_names = (
        "POSTGRES_DB",
        "POSTGRES_USER",
        "POSTGRES_PASSWORD",
        "POSTGRES_HOST",
        "POSTGRES_PORT",
        "ENVIRONMENT",
    )
    if any(not values.get(name) for name in required_names):
        raise MirrorRefusal("the private local configuration is incomplete")
    if values["POSTGRES_DB"] != database:
        raise MirrorRefusal("--database must exactly match the private POSTGRES_DB")
    if values["ENVIRONMENT"].lower() != "dev":
        raise MirrorRefusal("ENVIRONMENT must be dev for the disposable local mirror")
    if not is_loopback_address(values["POSTGRES_HOST"]):
        raise MirrorRefusal("local POSTGRES_HOST must be loopback-only")
    try:
        port = int(values["POSTGRES_PORT"])
    except ValueError as error:
        raise MirrorRefusal("POSTGRES_PORT must be numeric") from error
    if not 1 <= port <= 65535:
        raise MirrorRefusal("POSTGRES_PORT is outside the valid range")
    return LocalDatabaseConfig(
        database=values["POSTGRES_DB"],
        user=values["POSTGRES_USER"],
        password=values["POSTGRES_PASSWORD"],
        host=values["POSTGRES_HOST"],
        port=port,
        environment=values["ENVIRONMENT"].lower(),
    )


def resolve_snapshot_sql() -> Path:
    """Resolve the repository or installed snapshot SQL without configuration."""
    script_path = Path(__file__).resolve()
    installed_candidate = script_path.parent / "postgres-snapshot.sql"
    repository_candidate = script_path.parents[2] / "backup" / "postgres-snapshot.sql"
    for candidate in (installed_candidate, repository_candidate):
        if candidate.is_file() and not candidate.is_symlink():
            return candidate
    raise MirrorRefusal("the reviewed PostgreSQL snapshot SQL file is missing")


def prepare_paths() -> MirrorPaths:
    """Create private persistent state paths outside repository worktrees."""
    root = Path(os.getenv("LGA_OPERATION_ROOT", DEFAULT_OPERATION_ROOT)).expanduser()
    if not root.is_absolute() or root in {Path("/"), Path.home()}:
        raise MirrorRefusal("LGA_OPERATION_ROOT must be a dedicated absolute directory")
    state_directory = root / "state" / "local-postgres-mirror"
    for directory in (root, state_directory):
        if directory.exists() and directory.is_symlink():
            raise MirrorRefusal("a managed mirror directory must not be a symlink")
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        directory.chmod(0o700)
    return MirrorPaths(
        root=root,
        state_directory=state_directory,
        state_file=state_directory / "replacement.state",
        lock_file=root / ".local-postgres-mirror.lock",
        snapshot_sql=resolve_snapshot_sql(),
    )


def acquire_lock(path: Path) -> int:
    """Acquire the non-blocking single-run mirror lock."""
    descriptor = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    os.fchmod(descriptor, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError as error:
        os.close(descriptor)
        raise MirrorRefusal(
            "another League Analysis local mirror is running"
        ) from error
    return descriptor


def child_environment(config: LocalDatabaseConfig) -> dict[str, str]:
    """Keep libpq authentication in the child environment and off argv."""
    environment = os.environ.copy()
    environment["PGPASSWORD"] = config.password
    return environment


def psql_query(config: LocalDatabaseConfig, database: str, sql: str) -> str:
    """Run one fail-closed local SQL query without exposing credentials."""
    result = subprocess.run(
        [
            "psql",
            "--host",
            config.host,
            "--port",
            str(config.port),
            "--username",
            config.user,
            "--dbname",
            database,
            "--no-psqlrc",
            "--set",
            "ON_ERROR_STOP=1",
            "--tuples-only",
            "--no-align",
            "--command",
            sql,
        ],
        env=child_environment(config),
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def psql_snapshot(
    config: LocalDatabaseConfig, database: str, snapshot_sql: Path
) -> str:
    """Return the secret-free deterministic database snapshot."""
    result = subprocess.run(
        [
            "psql",
            "--host",
            config.host,
            "--port",
            str(config.port),
            "--username",
            config.user,
            "--dbname",
            database,
            "--no-psqlrc",
            "--set",
            "ON_ERROR_STOP=1",
            "--tuples-only",
            "--no-align",
            "--file",
            str(snapshot_sql),
        ],
        env=child_environment(config),
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def database_alembic_head(config: LocalDatabaseConfig, database: str) -> str:
    """Read one validated Alembic head from a local database."""
    head = psql_query(
        config, database, "SELECT version_num FROM public.alembic_version;"
    )
    if ALEMBIC_HEAD_PATTERN.fullmatch(head) is None:
        raise MirrorRefusal(f"database {database} has an invalid Alembic head")
    return head


def verify_local_database(config: LocalDatabaseConfig) -> str:
    """Prove the exact local target, PostgreSQL version, and loopback binding."""
    identity = psql_query(
        config,
        config.database,
        "SELECT current_database() || '|' || inet_server_addr()::text || '|' "
        "|| current_setting('server_version');",
    ).split("|")
    if (
        len(identity) != 3
        or identity[0] != LOCAL_DATABASE
        or not is_loopback_address(identity[1])
        or not identity[2].startswith("18.")
    ):
        raise MirrorRefusal("the active local PostgreSQL 18 target is not verified")
    listen_addresses = psql_query(config, config.database, "SHOW listen_addresses;")
    listen_items = [
        item.strip().strip("'\"")
        for item in listen_addresses.split(",")
        if item.strip()
    ]
    if not listen_items or not all(is_loopback_address(item) for item in listen_items):
        raise MirrorRefusal("local PostgreSQL listen_addresses is not loopback-only")
    alembic_head = database_alembic_head(config, config.database)
    if (
        psql_query(
            config,
            config.database,
            "SELECT rolcreatedb FROM pg_roles WHERE rolname = current_user;",
        )
        != "t"
    ):
        raise MirrorRefusal(
            "the configured local role requires CREATEDB for safe staging"
        )
    return alembic_head


def remote_operation_command(*arguments: str) -> str:
    """Build one constrained command over the supported Pi helper layouts."""
    candidates = " ".join(f'"{candidate}"' for candidate in REMOTE_SCRIPT_CANDIDATES)
    operation_arguments = " ".join(shlex.quote(argument) for argument in arguments)
    return (
        "set -eu; "
        f"for operation in {candidates}; do "
        'if [ -f "$operation" ] && [ ! -L "$operation" ] && '
        '[ -x "$operation" ]; then '
        f'exec "$operation" {operation_arguments}; '
        "fi; done; "
        "printf '%s\\n' 'League Analysis Pi operations helper is unavailable.' >&2; "
        "exit 127"
    )


def remote_identity(host: str) -> str:
    """Read the secret-safe exact Pi identity through the approved SSH alias."""
    result = subprocess.run(
        ["ssh", host, remote_operation_command("identity")],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def verify_remote_source(host: str, database: str, local_alembic_head: str) -> str:
    """Require the exact Pi source and a schema matching the local database."""
    identity = remote_identity(host)
    required_fragments = (
        "container=league-analysis-postgres",
        "compose_project=league-analysis",
        "compose_service=postgres",
        f"database={database}",
        "postgres=18.",
        "host_ports=none",
    )
    if any(fragment not in identity for fragment in required_fragments):
        raise MirrorRefusal(f"unexpected secret-safe Pi identity: {identity}")
    remote_head_match = re.search(
        r"(?:^| )alembic=([0-9]{8}_[0-9]{4})(?: |$)", identity
    )
    if remote_head_match is None:
        raise MirrorRefusal(f"unexpected secret-safe Pi identity: {identity}")
    remote_alembic_head = remote_head_match.group(1)
    if remote_alembic_head != local_alembic_head:
        raise MirrorRefusal(
            "the Pi and local Alembic heads differ "
            f"({remote_alembic_head} != {local_alembic_head}); "
            "the local database was left unchanged"
        )
    return identity


def remote_snapshot(host: str, database: str) -> str:
    """Read the deterministic secret-free Pi snapshot without database writes."""
    result = subprocess.run(
        [
            "ssh",
            host,
            remote_operation_command("snapshot", "--confirm-target", database),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def snapshot_digest(snapshot: str) -> str:
    """Return the stable digest used for comparison and diagnostics."""
    return hashlib.sha256(f"{snapshot}\n".encode()).hexdigest()


def download_remote_archive(host: str, database: str, archive: Path) -> str:
    """Download and validate a full read-only Pi custom-format dump."""
    descriptor = os.open(
        archive, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600
    )
    try:
        with os.fdopen(descriptor, "wb") as archive_output:
            subprocess.run(
                [
                    "ssh",
                    host,
                    remote_operation_command(
                        "mirror-dump", "--confirm-target", database
                    ),
                ],
                stdout=archive_output,
                check=True,
            )
            archive_output.flush()
            os.fsync(archive_output.fileno())
    except BaseException:
        archive.unlink(missing_ok=True)
        raise
    archive_stat = archive.stat()
    if stat.S_IMODE(archive_stat.st_mode) != 0o600 or archive_stat.st_size == 0:
        archive.unlink(missing_ok=True)
        raise MirrorRefusal("the downloaded Pi archive is empty or not mode 0600")
    subprocess.run(
        ["pg_restore", "--list", str(archive)],
        check=True,
        stdout=subprocess.DEVNULL,
    )
    digest = hashlib.sha256()
    with archive.open("rb") as archive_input:
        for chunk in iter(lambda: archive_input.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def require_database_name(database: str) -> None:
    """Constrain all generated names before embedding them in local SQL."""
    if not DATABASE_NAME_PATTERN.fullmatch(database):
        raise MirrorRefusal("an unsafe database name was refused")


def database_exists(config: LocalDatabaseConfig, database: str) -> bool:
    """Return whether one already-validated local database name exists."""
    require_database_name(database)
    return (
        psql_query(
            config,
            "postgres",
            f"SELECT count(*) FROM pg_database WHERE datname = '{database}';",
        )
        == "1"
    )


def create_database(config: LocalDatabaseConfig, database: str) -> None:
    """Create one isolated local staging database."""
    require_database_name(database)
    subprocess.run(
        [
            "createdb",
            "--host",
            config.host,
            "--port",
            str(config.port),
            "--username",
            config.user,
            "--owner",
            config.user,
            "--template",
            "template0",
            database,
        ],
        env=child_environment(config),
        check=True,
    )


def drop_database(config: LocalDatabaseConfig, database: str) -> None:
    """Drop only one already-validated generated or local target database."""
    require_database_name(database)
    if database != LOCAL_DATABASE and not GENERATED_NAME_PATTERN.fullmatch(database):
        raise MirrorRefusal("refusing to drop a database outside the mirror contract")
    subprocess.run(
        [
            "dropdb",
            "--host",
            config.host,
            "--port",
            str(config.port),
            "--username",
            config.user,
            "--force",
            "--if-exists",
            database,
        ],
        env=child_environment(config),
        check=True,
    )


def restore_archive(config: LocalDatabaseConfig, database: str, archive: Path) -> None:
    """Restore a complete archive without replaying Pi ownership or ACLs."""
    require_database_name(database)
    subprocess.run(
        [
            "pg_restore",
            "--host",
            config.host,
            "--port",
            str(config.port),
            "--username",
            config.user,
            "--dbname",
            database,
            "--no-owner",
            "--no-privileges",
            "--exit-on-error",
            str(archive),
        ],
        env=child_environment(config),
        check=True,
    )


def set_connections_allowed(
    config: LocalDatabaseConfig, database: str, allowed: bool
) -> None:
    """Allow or refuse new connections for one validated database."""
    require_database_name(database)
    value = "true" if allowed else "false"
    psql_query(
        config,
        "postgres",
        f'ALTER DATABASE "{database}" WITH ALLOW_CONNECTIONS {value};',
    )


def terminate_connections(config: LocalDatabaseConfig, database: str) -> None:
    """Terminate local clients before a database rename or recovery."""
    require_database_name(database)
    psql_query(
        config,
        "postgres",
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
        f"WHERE datname = '{database}' AND pid <> pg_backend_pid();",
    )


def rename_database(config: LocalDatabaseConfig, old: str, new: str) -> None:
    """Atomically rename one validated local database."""
    require_database_name(old)
    require_database_name(new)
    psql_query(config, "postgres", f'ALTER DATABASE "{old}" RENAME TO "{new}";')


def validate_database(
    config: LocalDatabaseConfig,
    database: str,
    snapshot_sql: Path,
    expected_alembic_head: str,
) -> str:
    """Validate schema, constraints, admins, and deterministic restored state."""
    if database_alembic_head(config, database) != expected_alembic_head:
        raise MirrorRefusal(f"database {database} has an unexpected Alembic head")
    unvalidated = psql_query(
        config,
        database,
        "SELECT count(*) FROM pg_constraint WHERE connamespace IN "
        "(SELECT oid FROM pg_namespace WHERE nspname IN "
        "('auth','core','jobs','public')) AND NOT convalidated;",
    )
    if unvalidated != "0":
        raise MirrorRefusal(f"database {database} contains unvalidated constraints")
    table_count = psql_query(
        config,
        database,
        "SELECT count(*) FROM information_schema.tables WHERE table_schema IN "
        "('auth','core','jobs') AND table_type = 'BASE TABLE';",
    )
    if int(table_count) <= 0:
        raise MirrorRefusal(f"database {database} contains no application tables")
    admin_count = psql_query(
        config,
        database,
        "SELECT count(*) FROM auth.users WHERE lower(email) IN "
        "('mat.kadlec@email.cz','marek.hovadik@seznam.cz') "
        "AND is_active AND is_admin AND email_verified;",
    )
    if admin_count != "2":
        raise MirrorRefusal(
            f"database {database} does not contain both validated administrators"
        )
    return psql_snapshot(config, database, snapshot_sql)


def state_payload(
    phase: str, target: str, stage: str, rollback: str, digest: str
) -> dict[str, str]:
    """Build one non-secret replacement-state document."""
    return {
        "phase": phase,
        "target": target,
        "stage": stage,
        "rollback": rollback,
        "sha256": digest,
        "updated_at": datetime.now(UTC).isoformat(),
    }


def write_state(path: Path, payload: dict[str, str]) -> None:
    """Atomically persist local crash-recovery state."""
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=".replacement-state.", dir=path.parent
    )
    temporary = Path(temporary_name)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as state_output:
            json.dump(payload, state_output, sort_keys=True)
            state_output.write("\n")
            state_output.flush()
            os.fsync(state_output.fileno())
        os.replace(temporary, path)
        path.chmod(0o600)
    finally:
        temporary.unlink(missing_ok=True)


def read_state(path: Path) -> dict[str, str]:
    """Read and strictly validate non-secret crash-recovery state."""
    path_stat = path.lstat()
    if stat.S_ISLNK(path_stat.st_mode) or not stat.S_ISREG(path_stat.st_mode):
        raise MirrorRefusal("mirror replacement state is not a regular file")
    if stat.S_IMODE(path_stat.st_mode) != 0o600 or path_stat.st_uid != os.geteuid():
        raise MirrorRefusal("mirror replacement state must be current-user mode 0600")
    payload = json.loads(path.read_text(encoding="utf-8"))
    required_keys = {"phase", "target", "stage", "rollback", "sha256", "updated_at"}
    if set(payload) != required_keys or not all(
        isinstance(value, str) for value in payload.values()
    ):
        raise MirrorRefusal("mirror replacement state has an invalid shape")
    if (
        payload["target"] != LOCAL_DATABASE
        or not GENERATED_NAME_PATTERN.fullmatch(payload["stage"])
        or not GENERATED_NAME_PATTERN.fullmatch(payload["rollback"])
        or not re.fullmatch(r"[0-9a-f]{64}", payload["sha256"])
        or payload["phase"] not in {"staging", "swapping", "validating", "committing"}
    ):
        raise MirrorRefusal("mirror replacement state failed identity validation")
    return payload


def classify_recovery(
    phase: str, *, target_exists: bool, stage_exists: bool, rollback_exists: bool
) -> str:
    """Choose the only safe recovery for a durable database-name state."""
    if rollback_exists:
        return "restore_rollback"
    if target_exists and stage_exists:
        return "discard_stage"
    if phase == "committing" and target_exists and not stage_exists:
        return "accept_committed"
    raise MirrorRefusal(
        "pending mirror database state is ambiguous; operator review required"
    )


def recover_pending_replacement(
    config: LocalDatabaseConfig, paths: MirrorPaths
) -> None:
    """Restore the pre-sync local database after interruption or validation failure."""
    if not paths.state_file.exists():
        return
    payload = read_state(paths.state_file)
    target = payload["target"]
    stage = payload["stage"]
    rollback = payload["rollback"]
    target_exists = database_exists(config, target)
    stage_exists = database_exists(config, stage)
    rollback_exists = database_exists(config, rollback)
    action = classify_recovery(
        payload["phase"],
        target_exists=target_exists,
        stage_exists=stage_exists,
        rollback_exists=rollback_exists,
    )

    if action == "restore_rollback":
        if target_exists:
            set_connections_allowed(config, target, False)
            terminate_connections(config, target)
            drop_database(config, target)
        if stage_exists:
            drop_database(config, stage)
        set_connections_allowed(config, rollback, True)
        rename_database(config, rollback, target)
        restored_head = database_alembic_head(config, target)
        validate_database(config, target, paths.snapshot_sql, restored_head)
        print("Recovered the pre-sync local database from durable rollback state.")
    elif action == "discard_stage":
        set_connections_allowed(config, target, True)
        drop_database(config, stage)
        print(
            "Removed an interrupted local staging database; the mirror target was unchanged."
        )
    else:
        committed_head = database_alembic_head(config, target)
        validate_database(config, target, paths.snapshot_sql, committed_head)
        print("Confirmed an interrupted mirror had already committed successfully.")
    paths.state_file.unlink()


def activate_archive(
    config: LocalDatabaseConfig,
    paths: MirrorPaths,
    archive: Path,
    digest: str,
    expected_alembic_head: str,
) -> str:
    """Restore, validate, atomically swap, and discard the old local snapshot."""
    timestamp = datetime.now().astimezone().strftime("%Y%m%dt%H%M%S")
    stage = f"{LOCAL_DATABASE}_mirror_stage_{timestamp}"
    rollback = f"{LOCAL_DATABASE}_mirror_rollback_{timestamp}"
    if not GENERATED_NAME_PATTERN.fullmatch(
        stage
    ) or not GENERATED_NAME_PATTERN.fullmatch(rollback):
        raise MirrorRefusal("generated local mirror database names are invalid")
    if database_exists(config, stage) or database_exists(config, rollback):
        raise MirrorRefusal("generated local mirror database already exists")

    create_database(config, stage)
    try:
        write_state(
            paths.state_file,
            state_payload("staging", LOCAL_DATABASE, stage, rollback, digest),
        )
    except BaseException:
        drop_database(config, stage)
        raise

    try:
        restore_archive(config, stage, archive)
        validate_database(config, stage, paths.snapshot_sql, expected_alembic_head)
        set_connections_allowed(config, stage, False)
        write_state(
            paths.state_file,
            state_payload("swapping", LOCAL_DATABASE, stage, rollback, digest),
        )
        set_connections_allowed(config, LOCAL_DATABASE, False)
        terminate_connections(config, LOCAL_DATABASE)
        rename_database(config, LOCAL_DATABASE, rollback)
        rename_database(config, stage, LOCAL_DATABASE)
        set_connections_allowed(config, LOCAL_DATABASE, True)
        write_state(
            paths.state_file,
            state_payload("validating", LOCAL_DATABASE, stage, rollback, digest),
        )
        snapshot = validate_database(
            config, LOCAL_DATABASE, paths.snapshot_sql, expected_alembic_head
        )
        write_state(
            paths.state_file,
            state_payload("committing", LOCAL_DATABASE, stage, rollback, digest),
        )
        drop_database(config, rollback)
        paths.state_file.unlink()
        return snapshot
    except BaseException:
        recover_pending_replacement(config, paths)
        raise


def install_signal_handlers() -> None:
    """Turn service interruption into the normal durable recovery path."""

    def interrupt(signum: int, _frame: object) -> NoReturn:
        raise InterruptedError(f"local mirror interrupted by signal {signum}")

    for signal_name in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(signal_name, interrupt)


def mirror(
    config: LocalDatabaseConfig,
    paths: MirrorPaths,
    host: str,
    database: str,
    expected_alembic_head: str,
) -> None:
    """Download a complete Pi archive before replacing any local database."""
    with tempfile.TemporaryDirectory(prefix="league-analysis-pi-mirror-") as temporary:
        temporary_path = Path(temporary)
        temporary_path.chmod(0o700)
        archive = temporary_path / "pi-source.dump"
        digest = download_remote_archive(host, database, archive)
        snapshot = activate_archive(
            config, paths, archive, digest, expected_alembic_head
        )
    local_snapshot_digest = snapshot_digest(snapshot)
    print(f"Activated complete Pi archive SHA-256: {digest}")
    print(f"Validated local snapshot SHA-256: {local_snapshot_digest}")
    print("Local PostgreSQL now contains a coherent disposable mirror of the Pi.")


def refresh_if_changed(
    config: LocalDatabaseConfig,
    paths: MirrorPaths,
    host: str,
    database: str,
    expected_alembic_head: str,
) -> bool:
    """Skip the full archive transfer when Pi and local snapshots already match."""
    source_snapshot = remote_snapshot(host, database)
    current_snapshot = psql_snapshot(config, config.database, paths.snapshot_sql)
    source_digest = snapshot_digest(source_snapshot)
    current_digest = snapshot_digest(current_snapshot)
    if source_digest == current_digest:
        print(f"Pi/local snapshot already matches: {source_digest}")
        print("Skipped full dump, transfer, restore, and database swap.")
        return False
    print(f"Pi snapshot differs from local: {source_digest}")
    mirror(config, paths, host, database, expected_alembic_head)
    return True


def main(argv: list[str] | None = None) -> int:
    """Run the mirror preflight or apply one full Pi-to-local refresh."""
    arguments = parse_arguments(argv)
    try:
        paths = prepare_paths()
        lock_descriptor = acquire_lock(paths.lock_file)
        try:
            install_signal_handlers()
            config = load_local_config(arguments.config, arguments.database)
            local_alembic_head = verify_local_database(config)
            recover_pending_replacement(config, paths)
            local_alembic_head = verify_local_database(config)
            identity = verify_remote_source(
                arguments.remote,
                arguments.remote_database,
                local_alembic_head,
            )
            if not arguments.apply:
                print("Local mirror preflight passed; no database changes were made.")
                print(f"Verified Pi source: {identity}")
                print(
                    "Use --apply to download and atomically activate a full snapshot."
                )
                return 0
            refresh_if_changed(
                config,
                paths,
                arguments.remote,
                arguments.remote_database,
                local_alembic_head,
            )
            return 0
        finally:
            os.close(lock_descriptor)
    except (MirrorRefusal, OSError, ValueError, subprocess.SubprocessError) as error:
        print(
            f"League Analysis local mirror refused or failed: {error}", file=sys.stderr
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
