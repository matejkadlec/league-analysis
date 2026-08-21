#!/usr/bin/env python3
"""Cleanse verified local Riot data and normalize the LGA-11 QA accounts.

The command is intentionally fail-closed. It is read-only by default and will
only mutate a database after an explicit ``--apply`` plus a verified backup.
It is for the local development database only; it must never be used for a
production or shared database.
"""

from __future__ import annotations

import argparse
import ipaddress
import os
import re
import subprocess
import sys
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import URL, Connection, Engine, RowMapping, create_engine, text

from app.core.config import Settings, get_global_settings
from app.features.auth.service import pwd_context

BACKEND_ROOT = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_ROOT.parent

load_dotenv(PROJECT_ROOT / ".env", override=False)

ADMIN_EMAIL = "mat.kadlec@email.cz"
ADMIN_PASSWORD = "LocalAdminQa123!"
CLIENT_EMAIL = "scipiocz@gmail.com"
CLIENT_DISPLAY_NAME = "John Doe"
CLIENT_PASSWORD = "LocalUserQa123!"

LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})

# Delete dependent rows first so every removal is explicit and reviewable.
RIOT_DATA_TABLES = (
    ("jobs", "player_sync_runs"),
    ("auth", "user_tracked_players"),
    ("core", "match_timelines"),
    ("core", "match_participants"),
    ("core", "matches"),
    ("core", "player_leagues"),
    ("core", "matchmaking_analyses"),
    ("core", "playstyle_analyses"),
    ("core", "players"),
)

# These records represent application configuration or audit state and are
# preserved. User counts can increase by one only when the client fixture is
# first created.
PRESERVED_TABLES = (
    ("auth", "users"),
    ("auth", "user_settings"),
    ("auth", "user_cookie_consents"),
    ("auth", "subject_counts"),
    ("auth", "join_us_contact_submissions"),
    ("core", "riot_api_keys"),
    ("jobs", "job_configurations"),
    ("jobs", "job_executions"),
    ("jobs", "apscheduler_jobs"),
)

REQUIRED_TABLES = frozenset(
    RIOT_DATA_TABLES
    + PRESERVED_TABLES
    + (
        ("auth", "refresh_tokens"),
        ("auth", "revoked_access_tokens"),
        ("auth", "email_change_requests"),
    )
)


class LocalCleanupRefusal(RuntimeError):
    """Raised when the command cannot prove its local-only safety boundary."""


@dataclass(frozen=True)
class Preflight:
    """Verified target facts used for the dry run and optional mutation."""

    admin_id: int
    client_id: int | None
    server_address: str
    listen_addresses: str


def validated_database_name(value: str) -> str:
    """Accept only a simple PostgreSQL database name supplied by the operator."""
    if re.fullmatch(r"[a-z][a-z0-9_]{0,62}", value) is None:
        raise argparse.ArgumentTypeError(
            "database names must use lowercase letters, digits, and underscores"
        )
    return value


def is_local_host(host: str) -> bool:
    """Return whether the configured connection host is an unambiguous loopback."""
    return host.strip().strip("[]").lower() in LOCAL_HOSTS


def is_loopback_address(value: str) -> bool:
    """Return whether PostgreSQL reported a loopback listener address."""
    try:
        return ipaddress.ip_interface(value).ip.is_loopback
    except ValueError:
        return False


def is_loopback_listener_configuration(value: str) -> bool:
    """Return whether every configured PostgreSQL bind address is loopback-only."""
    addresses = [address.strip().strip("'\"") for address in value.split(",")]
    return bool(addresses) and all(
        address and is_local_host(address) for address in addresses
    )


def validate_configured_target(settings: Settings, database: str) -> None:
    """Refuse a non-local configured target before opening a database connection."""
    environment = os.environ.get("ENVIRONMENT", "").strip().lower()
    if environment != "dev" or settings.environment != "dev":
        raise LocalCleanupRefusal("ENVIRONMENT must be explicitly set to dev")
    if not is_local_host(settings.postgres_host):
        raise LocalCleanupRefusal("POSTGRES_HOST must be localhost, 127.0.0.1, or ::1")
    if settings.postgres_db != database:
        raise LocalCleanupRefusal(
            "--database must exactly match the configured POSTGRES_DB"
        )


def table_label(table: tuple[str, str]) -> str:
    """Return the stable schema-qualified label used in reports."""
    return f"{table[0]}.{table[1]}"


def connection_url(settings: Settings, database: str) -> URL:
    """Build a secret-safe SQLAlchemy URL for one already verified database."""
    return URL.create(
        "postgresql+psycopg2",
        username=settings.postgres_user,
        password=settings.postgres_password,
        host=settings.postgres_host,
        port=settings.postgres_port,
        database=database,
    )


def parse_arguments(argv: list[str] | None = None) -> argparse.Namespace:
    """Require explicit database targeting and an explicit mutation opt-in."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--database",
        required=True,
        type=validated_database_name,
        help="Exact local database name; it must also match POSTGRES_DB.",
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--apply",
        action="store_true",
        help="Create a verified backup, then perform the cleanup transaction.",
    )
    mode.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the verified plan only (the default).",
    )
    mode.add_argument(
        "--resume-writers",
        action="store_true",
        help="Remove the persistent local Riot-writer maintenance interlock.",
    )
    parser.add_argument(
        "--backup-path",
        type=Path,
        help="New absolute path for the required pg_dump custom-format backup.",
    )
    arguments = parser.parse_args(argv)
    if arguments.apply and arguments.backup_path is None:
        parser.error("--apply requires --backup-path")
    if not arguments.apply and arguments.backup_path is not None:
        parser.error("--backup-path is valid only with --apply")
    return arguments


def validated_backup_path(value: Path) -> Path:
    """Return a canonical new backup path outside the canonical repository root."""
    if not value.is_absolute():
        raise LocalCleanupRefusal("backup path must be absolute")
    if os.path.lexists(value):
        raise LocalCleanupRefusal("backup path already exists")
    try:
        resolved_value = value.resolve(strict=False)
        resolved_project_root = PROJECT_ROOT.resolve()
    except (OSError, RuntimeError) as error:
        raise LocalCleanupRefusal("backup path cannot be resolved safely") from error
    try:
        resolved_value.relative_to(resolved_project_root)
    except ValueError:
        return resolved_value
    raise LocalCleanupRefusal("backup path must stay outside the repository")


def table_counts(
    connection: Connection, tables: tuple[tuple[str, str], ...]
) -> dict[str, int]:
    """Return exact row counts for reviewed, hard-coded table names."""
    return {
        table_label(table): connection.execute(
            text(f'SELECT COUNT(*) FROM "{table[0]}"."{table[1]}"')
        ).scalar_one()
        for table in tables
    }


def account_rows(connection: Connection, email: str) -> list[RowMapping]:
    """Find one account by normalized email without exposing its password hash."""
    return list(
        connection.execute(
            text(
                "SELECT id, email, is_admin FROM auth.users "
                "WHERE lower(email) = lower(:email) ORDER BY id"
            ),
            {"email": email},
        ).mappings()
    )


def assert_required_tables(connection: Connection) -> None:
    """Require every table used by the reviewed cleanup plan to exist."""
    missing = [
        table_label(table)
        for table in sorted(REQUIRED_TABLES)
        if not connection.execute(
            text("SELECT to_regclass(:table_name) IS NOT NULL"),
            {"table_name": table_label(table)},
        ).scalar_one()
    ]
    if missing:
        raise LocalCleanupRefusal(
            f"target does not contain the required application tables: {', '.join(missing)}"
        )


def preflight(connection: Connection, settings: Settings, database: str) -> Preflight:
    """Prove the exact target is an explicit local development database."""
    validate_configured_target(settings, database)

    current_database = connection.execute(
        text("SELECT current_database()")
    ).scalar_one()
    if current_database != database:
        raise LocalCleanupRefusal(
            "connected database does not match the confirmed target"
        )

    listen_addresses = str(
        connection.execute(text("SHOW listen_addresses")).scalar_one()
    )
    if not is_loopback_listener_configuration(listen_addresses):
        raise LocalCleanupRefusal(
            "PostgreSQL listen_addresses contains a non-loopback bind address"
        )

    server_address = str(
        connection.execute(text("SELECT inet_server_addr()")).scalar_one()
    )
    if not is_loopback_address(server_address):
        raise LocalCleanupRefusal("PostgreSQL listener is not loopback-only")

    assert_required_tables(connection)

    admin_rows = account_rows(connection, ADMIN_EMAIL)
    if len(admin_rows) != 1 or not admin_rows[0]["is_admin"]:
        raise LocalCleanupRefusal(
            "the required existing admin account is missing or is not admin"
        )

    client_rows = account_rows(connection, CLIENT_EMAIL)
    if len(client_rows) > 1:
        raise LocalCleanupRefusal("multiple client accounts match the required email")
    if client_rows:
        settings_count = connection.execute(
            text("SELECT COUNT(*) FROM auth.user_settings WHERE user_id = :user_id"),
            {"user_id": client_rows[0]["id"]},
        ).scalar_one()
        if settings_count != 1:
            raise LocalCleanupRefusal(
                "existing client account does not have exactly one settings row"
            )

    return Preflight(
        admin_id=admin_rows[0]["id"],
        client_id=client_rows[0]["id"] if client_rows else None,
        server_address=server_address,
        listen_addresses=listen_addresses,
    )


def create_verified_backup(
    settings: Settings, database: str, backup_path: Path
) -> None:
    """Create a restorable custom-format pg_dump without printing credentials."""
    environment = os.environ.copy()
    environment["PGPASSWORD"] = settings.postgres_password
    dump_command = [
        "pg_dump",
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        f"--host={settings.postgres_host}",
        f"--port={settings.postgres_port}",
        f"--username={settings.postgres_user}",
        f"--dbname={database}",
    ]
    descriptor = os.open(backup_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as backup_output:
            subprocess.run(
                dump_command,
                check=True,
                stdout=backup_output,
                stderr=subprocess.PIPE,
                env=environment,
            )
            backup_output.flush()
            os.fsync(backup_output.fileno())
        subprocess.run(
            ["pg_restore", "--list", str(backup_path)],
            check=True,
            capture_output=True,
            text=True,
            env=environment,
        )
    except (FileNotFoundError, subprocess.CalledProcessError, OSError) as error:
        backup_path.unlink(missing_ok=True)
        raise LocalCleanupRefusal("backup creation or verification failed") from error


def lock_cleanup_tables(connection: Connection) -> None:
    """Block cleanup-table writers while allowing pg_dump's read lock to proceed."""
    changed_tables = (
        *RIOT_DATA_TABLES,
        ("auth", "users"),
        ("auth", "user_settings"),
        ("auth", "refresh_tokens"),
        ("auth", "email_change_requests"),
        ("jobs", "job_configurations"),
        ("jobs", "job_executions"),
    )
    qualified_tables = ", ".join(
        f'"{schema}"."{table}"' for schema, table in changed_tables
    )
    connection.execute(
        text(f"LOCK TABLE {qualified_tables} IN SHARE ROW EXCLUSIVE MODE")
    )


def active_regular_riot_writer_execution_ids(connection: Connection) -> list[int]:
    """Return regular writer executions that must finish before cleanup can run."""
    rows = (
        connection.execute(
            text(
                "SELECT execution.id FROM jobs.job_executions AS execution "
                "JOIN jobs.job_configurations AS configuration "
                "ON configuration.id = execution.job_config_id "
                "WHERE configuration.job_type::text IN ('MATCH_FETCHER', 'PLAYER_UPDATER') "
                "AND execution.execution_type::text = 'REGULAR' "
                "AND execution.status::text IN ('RUNNING', 'PAUSED') "
                "ORDER BY execution.id"
            )
        )
        .scalars()
        .all()
    )
    return [int(execution_id) for execution_id in rows]


def refuse_active_regular_riot_writers(connection: Connection) -> None:
    """Fail before cleanup whenever a regular Riot writer can still mutate rows."""
    active_execution_ids = active_regular_riot_writer_execution_ids(connection)
    if active_execution_ids:
        joined_ids = ", ".join(
            str(execution_id) for execution_id in active_execution_ids
        )
        raise LocalCleanupRefusal(
            "active regular Riot writer executions block maintenance: " + joined_ids
        )


def enable_riot_writer_maintenance_mode(connection: Connection) -> int:
    """Persist the interlock that cancels regular Riot writers before they write."""
    updated_job_types = (
        connection.execute(
            text(
                "UPDATE jobs.job_configurations "
                "SET config_json = jsonb_set("
                "COALESCE(config_json, '{}'::jsonb), "
                "'{riot_maintenance_mode}', 'true'::jsonb, TRUE), "
                "updated_at = CURRENT_TIMESTAMP "
                "WHERE job_type::text IN ('MATCH_FETCHER', 'PLAYER_UPDATER') "
                "RETURNING job_type::text"
            )
        )
        .scalars()
        .all()
    )
    if sorted(updated_job_types) != ["MATCH_FETCHER", "PLAYER_UPDATER"]:
        raise LocalCleanupRefusal(
            "expected exactly one Match Fetcher and one Player Updater configuration before cleanup"
        )
    return len(updated_job_types)


def resume_riot_writers(connection: Connection) -> int:
    """Remove the interlock only after the caller has locked and checked writers."""
    return connection.execute(
        text(
            "UPDATE jobs.job_configurations "
            "SET config_json = COALESCE(config_json, '{}'::jsonb) "
            "- 'riot_maintenance_mode', updated_at = CURRENT_TIMESTAMP "
            "WHERE job_type::text IN ('MATCH_FETCHER', 'PLAYER_UPDATER') "
            "AND config_json ? 'riot_maintenance_mode'"
        )
    ).rowcount


def delete_riot_data(connection: Connection) -> dict[str, int]:
    """Delete every reviewed Riot-derived table and clear player context."""
    deleted = {
        "auth.user_settings_current_player": connection.execute(
            text(
                "UPDATE auth.user_settings SET current_player_puuid = NULL, "
                "updated_at = CURRENT_TIMESTAMP "
                "WHERE current_player_puuid IS NOT NULL"
            )
        ).rowcount
    }
    for schema, table in RIOT_DATA_TABLES:
        deleted[f"{schema}.{table}"] = connection.execute(
            text(f'DELETE FROM "{schema}"."{table}"')
        ).rowcount
    return deleted


def normalize_qa_accounts(connection: Connection, target: Preflight) -> bool:
    """Reset the retained admin and create or normalize the non-admin client."""
    # `pwd_context` rather than `AuthService`: the service's wrappers are
    # async because the API path must not block on Argon2, and this script
    # is synchronous throughout.
    admin_hash = pwd_context.hash(ADMIN_PASSWORD)
    client_hash = pwd_context.hash(CLIENT_PASSWORD)
    common_values = {
        "is_active": True,
        "email_verified": True,
        "failed_login_attempts": 0,
        "admin_id": target.admin_id,
        "admin_password_hash": admin_hash,
        "client_password_hash": client_hash,
    }
    connection.execute(
        text(
            "UPDATE auth.users SET password_hash = :admin_password_hash, "
            "is_active = :is_active, email_verified = :email_verified, "
            "email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP), "
            "failed_login_attempts = :failed_login_attempts, last_failed_login = NULL, "
            "locked_until = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = :admin_id"
        ),
        common_values,
    )

    client_created = target.client_id is None
    if client_created:
        client_id = connection.execute(
            text(
                "INSERT INTO auth.users "
                "(email, password_hash, display_name, is_active, is_admin, "
                "email_verified, email_verified_at, failed_login_attempts) "
                "VALUES (:email, :password_hash, :display_name, TRUE, FALSE, TRUE, "
                "CURRENT_TIMESTAMP, 0) RETURNING id"
            ),
            {
                "email": CLIENT_EMAIL,
                "password_hash": client_hash,
                "display_name": CLIENT_DISPLAY_NAME,
            },
        ).scalar_one()
    else:
        client_id = target.client_id
        connection.execute(
            text(
                "UPDATE auth.users SET email = :email, password_hash = :password_hash, "
                "display_name = :display_name, is_active = TRUE, is_admin = FALSE, "
                "email_verified = TRUE, "
                "email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP), "
                "failed_login_attempts = 0, last_failed_login = NULL, locked_until = NULL, "
                "updated_at = CURRENT_TIMESTAMP "
                "WHERE id = :client_id"
            ),
            {
                "client_id": client_id,
                "email": CLIENT_EMAIL,
                "password_hash": client_hash,
                "display_name": CLIENT_DISPLAY_NAME,
            },
        )

    for table in ("refresh_tokens", "email_change_requests"):
        connection.execute(
            text(
                f'DELETE FROM auth."{table}" WHERE user_id IN (:admin_id, :client_id)'
            ),
            {"admin_id": target.admin_id, "client_id": client_id},
        )

    settings_count = connection.execute(
        text("SELECT COUNT(*) FROM auth.user_settings WHERE user_id = :user_id"),
        {"user_id": client_id},
    ).scalar_one()
    if settings_count != 1:
        raise LocalCleanupRefusal(
            "client account did not receive exactly one settings row from the database trigger"
        )
    return client_created


def verify_after_cleanup(
    connection: Connection,
    before_preserved: Mapping[str, int],
    client_created: bool,
) -> None:
    """Prove deletion, preservation, account boundaries, and Argon2 usability."""
    remaining = table_counts(connection, RIOT_DATA_TABLES)
    nonempty = [label for label, count in remaining.items() if count != 0]
    if nonempty:
        raise LocalCleanupRefusal(
            f"Riot-derived rows remain after cleanup: {', '.join(nonempty)}"
        )

    after_preserved = table_counts(connection, PRESERVED_TABLES)
    expected_preserved = dict(before_preserved)
    if client_created:
        expected_preserved["auth.users"] += 1
        expected_preserved["auth.user_settings"] += 1
    if after_preserved != expected_preserved:
        raise LocalCleanupRefusal("a preserved table row count changed unexpectedly")

    rows = (
        connection.execute(
            text(
                "SELECT email, password_hash, is_admin, is_active, email_verified, "
                "failed_login_attempts, locked_until FROM auth.users "
                "WHERE email IN (:admin_email, :client_email) ORDER BY email"
            ),
            {"admin_email": ADMIN_EMAIL, "client_email": CLIENT_EMAIL},
        )
        .mappings()
        .all()
    )
    if len(rows) != 2:
        raise LocalCleanupRefusal(
            "expected QA account records are missing after cleanup"
        )

    accounts = {row["email"]: row for row in rows}
    admin = accounts.get(ADMIN_EMAIL)
    client = accounts.get(CLIENT_EMAIL)
    if admin is None or client is None:
        raise LocalCleanupRefusal(
            "QA accounts do not have the expected email addresses"
        )
    if (
        not admin["is_admin"]
        or not admin["is_active"]
        or not admin["email_verified"]
        or admin["failed_login_attempts"] != 0
        or admin["locked_until"] is not None
        or not pwd_context.verify(ADMIN_PASSWORD, admin["password_hash"])
    ):
        raise LocalCleanupRefusal("admin QA account validation failed")
    if (
        client["is_admin"]
        or not client["is_active"]
        or not client["email_verified"]
        or client["failed_login_attempts"] != 0
        or client["locked_until"] is not None
        or not pwd_context.verify(CLIENT_PASSWORD, client["password_hash"])
    ):
        raise LocalCleanupRefusal("client QA account validation failed")


def print_plan(
    database: str,
    preflight_result: Preflight,
    riot_counts: Mapping[str, int],
    preserved_counts: Mapping[str, int],
) -> None:
    """Print a credential-free before-mutation report."""
    print(f"Verified local development target: {database}")
    print(
        "Verified PostgreSQL loopback bind configuration: "
        f"{preflight_result.listen_addresses}"
    )
    print(f"Verified PostgreSQL loopback listener: {preflight_result.server_address}")
    print("Riot-derived deletion plan:")
    for label, count in riot_counts.items():
        print(f"  {label}: {count}")
    print("Preserved-table counts:")
    for label, count in preserved_counts.items():
        print(f"  {label}: {count}")
    print(
        "QA account plan: retain/reset the existing admin; "
        + ("create" if preflight_result.client_id is None else "normalize")
        + " the non-admin client; clear their session and lockout state."
    )


def main(argv: list[str] | None = None) -> int:
    """Run a dry-run report or the explicit, backed-up cleanup transaction."""
    arguments = parse_arguments(argv)
    settings = get_global_settings()
    engine: Engine | None = None
    try:
        validate_configured_target(settings, arguments.database)
        engine = create_engine(connection_url(settings, arguments.database))
        with engine.connect() as connection:
            preflight_result = preflight(connection, settings, arguments.database)
            riot_counts = table_counts(connection, RIOT_DATA_TABLES)
            preserved_counts = table_counts(connection, PRESERVED_TABLES)
            print_plan(
                arguments.database,
                preflight_result,
                riot_counts,
                preserved_counts,
            )

        if arguments.resume_writers:
            with engine.begin() as connection:
                preflight(connection, settings, arguments.database)
                lock_cleanup_tables(connection)
                refuse_active_regular_riot_writers(connection)
                resumed_configurations = resume_riot_writers(connection)
            print(
                "Riot writer maintenance mode cleared for "
                f"{resumed_configurations} configuration(s)."
            )
            return 0

        if not arguments.apply:
            print(
                "Dry run passed. Re-run with --apply and a new --backup-path to mutate."
            )
            return 0

        backup_path = validated_backup_path(arguments.backup_path)

        with engine.begin() as connection:
            # Repeat identity checks and block writers before taking the backup.
            # The lock stays held through cleanup, so its backup covers every row
            # the transaction can delete or update.
            preflight_result = preflight(connection, settings, arguments.database)
            lock_cleanup_tables(connection)
            refuse_active_regular_riot_writers(connection)
            enable_riot_writer_maintenance_mode(connection)
            create_verified_backup(settings, arguments.database, backup_path)
            before_preserved = table_counts(connection, PRESERVED_TABLES)
            deleted = delete_riot_data(connection)
            client_created = normalize_qa_accounts(connection, preflight_result)
            verify_after_cleanup(connection, before_preserved, client_created)

        print(f"Verified backup created at {backup_path}")
        print("Cleanup applied successfully. Deleted-row counts:")
        for label, count in deleted.items():
            print(f"  {label}: {count}")
        print(
            "Both local-only QA account password hashes and authorization flags passed."
        )
        print(
            "Regular Riot writers remain blocked. Re-run with --resume-writers only "
            "after confirming the local environment is ready to ingest new Riot data."
        )
        return 0
    except LocalCleanupRefusal as error:
        print(f"Local cleanup refused: {error}", file=sys.stderr)
        return 1
    except Exception as error:
        print(f"Local cleanup failed: {type(error).__name__}", file=sys.stderr)
        return 1
    finally:
        if engine is not None:
            engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
