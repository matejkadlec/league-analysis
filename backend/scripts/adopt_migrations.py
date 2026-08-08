#!/usr/bin/env python3
"""Verify an existing schema before explicitly stamping the Alembic baseline."""

from __future__ import annotations

import argparse
import difflib
import os
import re
import subprocess
import sys
from pathlib import Path
from uuid import uuid4

from dotenv import load_dotenv
from sqlalchemy import URL, create_engine, text

BACKEND_ROOT = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_ROOT.parent
ADOPTION_BASELINE_REVISION = "20260803_0001"
EXPECTED_REVISION = "20260808_0003"

load_dotenv(PROJECT_ROOT / ".env", override=False)


def required_environment(name: str) -> str:
    """Read a required connection setting without exposing its value."""
    value = os.environ.get(name)
    if value is None or value.strip() == "":
        raise ValueError(f"Missing required environment variable: {name}")
    return value


def validated_database_name(value: str) -> str:
    """Accept only a simple PostgreSQL database name supplied by the operator."""
    if re.fullmatch(r"[a-z][a-z0-9_]{0,62}", value) is None:
        raise argparse.ArgumentTypeError(
            "database names must be lowercase letters, digits, or underscores"
        )
    return value


def administration_url() -> URL:
    """Build a maintenance connection without writing a secret-bearing URL."""
    return URL.create(
        "postgresql+psycopg2",
        username=required_environment("POSTGRES_USER"),
        password=required_environment("POSTGRES_PASSWORD"),
        host=required_environment("POSTGRES_HOST"),
        port=int(required_environment("POSTGRES_PORT")),
        database="postgres",
    )


def quoted_temporary_database(name: str) -> str:
    """Quote only a validator-generated database name for DDL."""
    if re.fullmatch(r"lga_migration_adoption_[0-9a-f]{32}", name) is None:
        raise ValueError("Refusing to use a non-validator temporary database")
    return f'"{name}"'


def create_temporary_database(url: URL, name: str) -> None:
    """Create a clean migration target with a unique, private name."""
    engine = create_engine(url, isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as connection:
            connection.execute(
                text(f"CREATE DATABASE {quoted_temporary_database(name)}")
            )
    finally:
        engine.dispose()


def drop_temporary_database(url: URL, name: str) -> None:
    """Delete only the private database that this verification created."""
    engine = create_engine(url, isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as connection:
            connection.execute(
                text(
                    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                    "WHERE datname = :database AND pid <> pg_backend_pid()"
                ),
                {"database": name},
            )
            connection.execute(
                text(f"DROP DATABASE IF EXISTS {quoted_temporary_database(name)}")
            )
    finally:
        engine.dispose()


def subprocess_environment(database: str) -> dict[str, str]:
    """Run migration tooling against one explicit database with safe test settings."""
    environment = os.environ.copy()
    environment.update(
        {
            "POSTGRES_DB": database,
            "DEBUG": "false",
            "ENVIRONMENT": "test",
            "JWT_SECRET_KEY": "league-analysis-migration-verification-secret",
        }
    )
    return environment


def run_migration_command(database: str, command_name: str, revision: str) -> None:
    """Run a locked upgrade or stamp command without logging connection values."""
    subprocess.run(
        [sys.executable, "scripts/migrate.py", command_name, revision],
        cwd=BACKEND_ROOT,
        env=subprocess_environment(database),
        check=True,
    )


def normalized_schema_dump(database: str) -> list[str]:
    """Return a stable schema-only dump for all application schemas."""
    environment = os.environ.copy()
    environment["PGPASSWORD"] = required_environment("POSTGRES_PASSWORD")
    result = subprocess.run(
        [
            "pg_dump",
            "--schema-only",
            "--no-owner",
            "--no-privileges",
            "--quote-all-identifiers",
            f"--host={required_environment('POSTGRES_HOST')}",
            f"--port={required_environment('POSTGRES_PORT')}",
            f"--username={required_environment('POSTGRES_USER')}",
            f"--dbname={database}",
            "--schema=auth",
            "--schema=core",
            "--schema=jobs",
        ],
        check=True,
        capture_output=True,
        text=True,
        env=environment,
    )
    return [
        line
        for line in result.stdout.splitlines()
        if line and not line.startswith("--") and not line.startswith("\\")
    ]


def application_row_counts(database: str) -> dict[str, int]:
    """Record all application-table row counts before and after an optional stamp."""
    url = administration_url().set(database=database)
    engine = create_engine(url)
    try:
        with engine.connect() as connection:
            tables = connection.execute(
                text(
                    "SELECT table_schema, table_name FROM information_schema.tables "
                    "WHERE table_type = 'BASE TABLE' "
                    "AND table_schema IN ('auth', 'core', 'jobs') "
                    "ORDER BY table_schema, table_name"
                )
            ).all()
            return {
                f"{schema}.{table}": connection.execute(
                    text(f'SELECT COUNT(*) FROM "{schema}"."{table}"')
                ).scalar_one()
                for schema, table in tables
            }
    finally:
        engine.dispose()


def existing_application_row_counts_unchanged(
    before_counts: dict[str, int], after_counts: dict[str, int]
) -> bool:
    """Ensure adoption and later upgrades preserve every pre-existing row count."""
    return all(
        after_counts.get(table_name) == row_count
        for table_name, row_count in before_counts.items()
    )


def stamped_revision(database: str) -> str | None:
    """Read the baseline marker if it is already present."""
    url = administration_url().set(database=database)
    engine = create_engine(url)
    try:
        with engine.connect() as connection:
            table_exists = connection.execute(
                text("SELECT to_regclass('public.alembic_version') IS NOT NULL")
            ).scalar_one()
            if not table_exists:
                return None
            return connection.execute(
                text("SELECT version_num FROM public.alembic_version")
            ).scalar_one()
    finally:
        engine.dispose()


def parse_arguments() -> argparse.Namespace:
    """Require explicit targeting and an explicit write opt-in."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True, type=validated_database_name)
    parser.add_argument(
        "--apply",
        action="store_true",
        help=(
            "Stamp the initial baseline then upgrade after a clean schema "
            "comparison; without it this is read-only."
        ),
    )
    return parser.parse_args()


def main() -> int:
    """Compare a populated database to a clean baseline and optionally stamp it."""
    arguments = parse_arguments()
    if stamped_revision(arguments.database) is not None:
        print(
            "Migration adoption refused: the target already has an Alembic marker.",
            file=sys.stderr,
        )
        return 1

    temporary_database = f"lga_migration_adoption_{uuid4().hex}"
    url = administration_url()
    created = False
    try:
        create_temporary_database(url, temporary_database)
        created = True
        run_migration_command(
            temporary_database,
            "upgrade",
            ADOPTION_BASELINE_REVISION,
        )
        expected = normalized_schema_dump(temporary_database)
        actual = normalized_schema_dump(arguments.database)
        if actual != expected:
            print(
                "Migration adoption refused: target schema differs from the baseline.",
                file=sys.stderr,
            )
            for line in list(
                difflib.unified_diff(
                    actual,
                    expected,
                    fromfile="existing",
                    tofile="alembic-baseline",
                    lineterm="",
                )
            )[:80]:
                print(line, file=sys.stderr)
            return 1

        before_counts = application_row_counts(arguments.database)
        if not arguments.apply:
            print(
                "Migration adoption verification passed; rerun with --apply to stamp "
                "the initial baseline and upgrade."
            )
            return 0

        run_migration_command(
            arguments.database,
            "stamp",
            ADOPTION_BASELINE_REVISION,
        )
        run_migration_command(arguments.database, "upgrade", EXPECTED_REVISION)
        after_counts = application_row_counts(arguments.database)
        revision = stamped_revision(arguments.database)
        if (
            not existing_application_row_counts_unchanged(before_counts, after_counts)
            or after_counts.get("auth.user_card_preferences") != 0
            or revision != EXPECTED_REVISION
        ):
            print("Migration adoption stamp verification failed.", file=sys.stderr)
            return 1
    except Exception as error:
        print(f"Migration adoption failed: {type(error).__name__}", file=sys.stderr)
        return 1
    finally:
        if created:
            drop_temporary_database(url, temporary_database)

    print("Migration adoption and upgrade passed without changing existing row counts.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
