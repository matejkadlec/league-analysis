#!/usr/bin/env python3
"""Replace the Pi database from a verified full local PostgreSQL snapshot.

The remote operation retains the previous Pi database under a rollback name
until explicit post-migration validation is complete. No database password is
sent over SSH or accepted through command-line arguments.
"""

from __future__ import annotations

import argparse
import difflib
import hashlib
import ipaddress
import os
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, text

BACKEND_ROOT = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_ROOT.parent
SNAPSHOT_SQL = PROJECT_ROOT / "deploy" / "postgres-snapshot.sql"
LOCAL_DATABASE = "league_analysis_local_dev"
REMOTE_DATABASE = "league_analysis"
REMOTE_HOST = "pi5ram8"
REMOTE_SCRIPT = "$HOME/.local/share/league-analysis/operations/pi-postgres-operations"
EXPECTED_ALEMBIC_HEAD = "20260809_0006"

if os.getenv("ENVIRONMENT", "").lower() != "test":
    for configuration_name in (
        "POSTGRES_DB",
        "POSTGRES_USER",
        "POSTGRES_PASSWORD",
        "POSTGRES_HOST",
        "POSTGRES_PORT",
        "DEBUG",
        "ENVIRONMENT",
        "JWT_SECRET_KEY",
    ):
        os.environ.pop(configuration_name, None)
    load_dotenv(PROJECT_ROOT / ".env", override=False)

from app.core.config import Settings, get_settings  # noqa: E402


class InitialMigrationRefusal(RuntimeError):
    """Raised when a migration safety or integrity prerequisite fails."""


def parse_arguments(argv: list[str] | None = None) -> argparse.Namespace:
    """Parse the narrow one-time migration command."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True, choices=(LOCAL_DATABASE,))
    parser.add_argument("--remote", default=REMOTE_HOST, choices=(REMOTE_HOST,))
    parser.add_argument(
        "--remote-database", default=REMOTE_DATABASE, choices=(REMOTE_DATABASE,)
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Create and transmit the full archive; the default is a dry run.",
    )
    return parser.parse_args(argv)


def is_loopback_address(value: str) -> bool:
    """Return whether one configured/observed address is loopback-only."""
    normalized = value.strip().strip("[]").lower()
    if normalized == "localhost":
        return True
    try:
        return ipaddress.ip_interface(normalized).ip.is_loopback
    except ValueError:
        return False


def local_child_environment(password: str) -> dict[str, str]:
    """Return a child environment with libpq authentication kept off argv."""
    child_environment = os.environ.copy()
    child_environment["PGPASSWORD"] = password
    return child_environment


def remote_command(action: str) -> str:
    """Build one constant-path command for the approved SSH alias."""
    return f'exec "{REMOTE_SCRIPT}" {action}'


def verify_local_database(database: str) -> tuple[Settings, dict[str, str]]:
    """Prove exact local identity, schema head, and loopback binding."""
    settings = get_settings()
    if settings.environment != "dev":
        raise InitialMigrationRefusal("ENVIRONMENT must be dev")
    if settings.postgres_db != database:
        raise InitialMigrationRefusal(
            "--database must exactly match the protected POSTGRES_DB value"
        )
    if not is_loopback_address(settings.postgres_host):
        raise InitialMigrationRefusal("local POSTGRES_HOST must be loopback-only")

    engine = create_engine(
        settings.database_url.replace(
            "postgresql+asyncpg://", "postgresql+psycopg2://", 1
        ),
        pool_pre_ping=True,
    )
    with engine.connect() as connection:
        row = connection.execute(
            text(
                "SELECT current_database(), inet_server_addr()::text, "
                "current_setting('server_version')"
            )
        ).one()
        if row[0] != database or not is_loopback_address(str(row[1])):
            raise InitialMigrationRefusal(
                "active local database identity is not the confirmed loopback target"
            )
        listen_addresses = str(
            connection.execute(text("SHOW listen_addresses")).scalar_one()
        )
        listen_address_items = [
            item.strip().strip("'\"")
            for item in listen_addresses.split(",")
            if item.strip()
        ]
        if not listen_address_items or not all(
            is_loopback_address(item) for item in listen_address_items
        ):
            raise InitialMigrationRefusal(
                "local PostgreSQL listen_addresses is not loopback-only"
            )
        alembic_head = connection.execute(
            text("SELECT version_num FROM public.alembic_version")
        ).scalar_one()
        if alembic_head != EXPECTED_ALEMBIC_HEAD:
            raise InitialMigrationRefusal(
                f"local Alembic head is {alembic_head}, expected {EXPECTED_ALEMBIC_HEAD}"
            )
        postgres_version = str(row[2])
        if not postgres_version.startswith("18."):
            raise InitialMigrationRefusal(
                f"local PostgreSQL 18 is required, found {postgres_version}"
            )
    engine.dispose()
    return settings, local_child_environment(settings.postgres_password)


def run_remote(
    host: str,
    action: str,
    *,
    capture_output: bool = False,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    """Run one secret-free remote command and preserve its diagnostics."""
    return subprocess.run(
        ["ssh", host, remote_command(action)],
        check=check,
        text=True,
        capture_output=capture_output,
    )


def create_archive(
    settings: Settings, child_environment: dict[str, str], path: Path
) -> str:
    """Create, fsync, inspect, and checksum one full custom-format archive."""
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as archive_output:
            subprocess.run(
                [
                    "pg_dump",
                    "--host",
                    settings.postgres_host,
                    "--port",
                    str(settings.postgres_port),
                    "--username",
                    settings.postgres_user,
                    "--dbname",
                    settings.postgres_db,
                    "--format=custom",
                    "--compress=gzip:9",
                    "--no-password",
                ],
                stdout=archive_output,
                env=child_environment,
                check=True,
            )
            archive_output.flush()
            os.fsync(archive_output.fileno())
    except Exception:
        path.unlink(missing_ok=True)
        raise
    if stat.S_IMODE(path.stat().st_mode) != 0o600 or path.stat().st_size == 0:
        path.unlink(missing_ok=True)
        raise InitialMigrationRefusal("local archive is empty or not mode 0600")
    subprocess.run(
        ["pg_restore", "--list", str(path)], check=True, stdout=subprocess.DEVNULL
    )
    digest = hashlib.sha256()
    with path.open("rb") as archive_input:
        for chunk in iter(lambda: archive_input.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def local_snapshot(settings: Settings, child_environment: dict[str, str]) -> str:
    """Return the secret-free deterministic local database snapshot."""
    result = subprocess.run(
        [
            "psql",
            "--host",
            settings.postgres_host,
            "--port",
            str(settings.postgres_port),
            "--username",
            settings.postgres_user,
            "--dbname",
            settings.postgres_db,
            "--no-psqlrc",
            "--set",
            "ON_ERROR_STOP=1",
            "--tuples-only",
            "--no-align",
            "--file",
            str(SNAPSHOT_SQL),
        ],
        env=child_environment,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def rollback_remote(host: str, remote_database: str, digest: str) -> None:
    """Request the exact rollback state if post-swap comparison fails."""
    run_remote(
        host,
        "rollback-replacement "
        f"--confirm-target {remote_database} --expected-sha256 {digest}",
    )


def apply_migration(
    *,
    settings: Settings,
    child_environment: dict[str, str],
    host: str,
    remote_database: str,
) -> None:
    """Dump local, replace the Pi target, and compare every table/sequence count."""
    with tempfile.TemporaryDirectory(prefix="league-analysis-lga79-") as temporary:
        temporary_path = Path(temporary)
        temporary_path.chmod(0o700)
        archive_path = temporary_path / "local-source.dump"
        digest = create_archive(settings, child_environment, archive_path)
        source_snapshot = local_snapshot(settings, child_environment)

        with archive_path.open("rb") as archive_input:
            subprocess.run(
                [
                    "ssh",
                    host,
                    remote_command(
                        "replace-from-stdin "
                        f"--confirm-target {remote_database} "
                        f"--expected-sha256 {digest}"
                    ),
                ],
                stdin=archive_input,
                check=True,
            )

        remote_result = run_remote(
            host,
            f"snapshot --confirm-target {remote_database}",
            capture_output=True,
        )
        remote_snapshot = remote_result.stdout.strip()
        if remote_snapshot != source_snapshot:
            difference = "\n".join(
                difflib.unified_diff(
                    source_snapshot.splitlines(),
                    remote_snapshot.splitlines(),
                    fromfile="local-source",
                    tofile="pi-restored",
                    lineterm="",
                )
            )
            print(difference, file=sys.stderr)
            rollback_remote(host, remote_database, digest)
            raise InitialMigrationRefusal(
                "Pi snapshot differs from local source; automatic rollback completed"
            )

        run_remote(
            host,
            "activate-replacement "
            f"--confirm-target {remote_database} --expected-sha256 {digest}",
        )

        print(f"Verified matching source archive SHA-256: {digest}")
        print(
            "All application table counts, sequence states, and admin flags matched "
            "before application writers restarted."
        )
        print(
            "The Pi replacement remains rollback-capable pending credential and "
            "application verification."
        )


def main(argv: list[str] | None = None) -> int:
    """Run the dry-run preflight or the initial migration."""
    arguments = parse_arguments(argv)
    try:
        settings, child_environment = verify_local_database(arguments.database)
        remote_identity = run_remote(
            arguments.remote, "identity", capture_output=True
        ).stdout.strip()
        if (
            f"database={arguments.remote_database}" not in remote_identity
            or "postgres=18." not in remote_identity
            or f"alembic={EXPECTED_ALEMBIC_HEAD}" not in remote_identity
            or "host_ports=none" not in remote_identity
        ):
            raise InitialMigrationRefusal(
                f"unexpected secret-safe Pi identity: {remote_identity}"
            )
        if arguments.apply and "authority=pi" in remote_identity:
            raise InitialMigrationRefusal(
                "Pi authority is already confirmed; local-to-Pi migration is disabled"
            )
        print(f"Verified local source: {arguments.database}, PostgreSQL 18")
        print(f"Verified Pi target: {remote_identity}")
        if not arguments.apply:
            print(
                "Dry run passed; use --apply only after the admin account is verified."
            )
            return 0
        apply_migration(
            settings=settings,
            child_environment=child_environment,
            host=arguments.remote,
            remote_database=arguments.remote_database,
        )
        return 0
    except (InitialMigrationRefusal, OSError, subprocess.SubprocessError) as error:
        print(
            f"Initial migration failed safely: {type(error).__name__}: {error}",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
