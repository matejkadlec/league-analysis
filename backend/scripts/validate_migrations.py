#!/usr/bin/env python3
"""Validate the Alembic baseline in an isolated PostgreSQL database."""

from __future__ import annotations

import asyncio
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from uuid import uuid4

from dotenv import load_dotenv
from metadata_drift import (
    BASELINE_PATH,
    compare_against_baseline,
    drift_signatures,
    import_every_model_module,
)
from migration_contract import EXPECTED_ALEMBIC_HEAD
from sqlalchemy import URL, create_engine, text

BACKEND_ROOT = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_ROOT.parent
SNAPSHOT_SQL = PROJECT_ROOT / "backup" / "postgres-snapshot.sql"
EXPECTED_REVISION = EXPECTED_ALEMBIC_HEAD
EXPECTED_POSTGRES_MAJOR = 18
POSTGRES_CLIENT_PROGRAMS = ("pg_dump", "pg_restore", "psql")

load_dotenv(PROJECT_ROOT / ".env", override=False)


def required_environment(name: str) -> str:
    """Read a required connection setting without printing its value."""
    value = os.environ.get(name)
    if value is None or value.strip() == "":
        raise ValueError(f"Missing required environment variable: {name}")
    return value


def administration_url() -> URL:
    """Connect to PostgreSQL's maintenance database with the configured role."""
    return URL.create(
        "postgresql+psycopg2",
        username=required_environment("POSTGRES_USER"),
        password=required_environment("POSTGRES_PASSWORD"),
        host=required_environment("POSTGRES_HOST"),
        port=int(required_environment("POSTGRES_PORT")),
        database="postgres",
    )


def temporary_database_name() -> str:
    """Return a unique name constrained to the validator's private namespace."""
    name = f"lga_migration_validation_{uuid4().hex}"
    if re.fullmatch(r"lga_migration_validation_[0-9a-f]{32}", name) is None:
        raise ValueError("Generated an invalid temporary database name")
    return name


def quoted_identifier(identifier: str) -> str:
    """Quote a generated database identifier after enforcing its exact shape."""
    if re.fullmatch(r"lga_migration_validation_[0-9a-f]{32}", identifier) is None:
        raise ValueError("Refusing to use a non-validator database name")
    return f'"{identifier}"'


def create_database(url: URL, database: str) -> None:
    """Create the private, empty database used by this validation run."""
    engine = create_engine(url, isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as connection:
            connection.execute(text(f"CREATE DATABASE {quoted_identifier(database)}"))
    finally:
        engine.dispose()


def drop_database(url: URL, database: str) -> None:
    """Terminate only validator-owned sessions and remove the private database."""
    engine = create_engine(url, isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as connection:
            connection.execute(
                text(
                    "SELECT pg_terminate_backend(pid) "
                    "FROM pg_stat_activity "
                    "WHERE datname = :database AND pid <> pg_backend_pid()"
                ),
                {"database": database},
            )
            connection.execute(
                text(f"DROP DATABASE IF EXISTS {quoted_identifier(database)}")
            )
    finally:
        engine.dispose()


def migration_environment(database: str) -> dict[str, str]:
    """Pass only a temporary database name to the migration subprocess."""
    environment = os.environ.copy()
    environment["POSTGRES_DB"] = database
    return environment


def postgres_client_environment() -> dict[str, str]:
    """Keep the validation password in child process state and off argv."""
    environment = os.environ.copy()
    environment["PGPASSWORD"] = required_environment("POSTGRES_PASSWORD")
    return environment


def validate_postgres_client_versions() -> None:
    """Fail before backup work unless every selected client is PostgreSQL 18."""
    for program in POSTGRES_CLIENT_PROGRAMS:
        result = subprocess.run(
            [program, "--version"],
            env=postgres_client_environment(),
            capture_output=True,
            text=True,
            check=True,
        )
        match = re.search(r"\b(\d+)(?:\.\d+)*\b", result.stdout)
        if match is None or int(match.group(1)) != EXPECTED_POSTGRES_MAJOR:
            observed = result.stdout.strip() or "unknown version"
            raise RuntimeError(
                f"{program} must be PostgreSQL {EXPECTED_POSTGRES_MAJOR}; "
                f"observed {observed}"
            )


def postgres_connection_arguments(database: str) -> list[str]:
    """Return the common non-secret PostgreSQL client arguments."""
    return [
        "--host",
        required_environment("POSTGRES_HOST"),
        "--port",
        required_environment("POSTGRES_PORT"),
        "--username",
        required_environment("POSTGRES_USER"),
        "--dbname",
        database,
    ]


def create_restore_archive(database: str, archive: Path) -> None:
    """Create and inspect one private custom-format validation archive."""
    descriptor = os.open(archive, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as archive_output:
            subprocess.run(
                [
                    "pg_dump",
                    *postgres_connection_arguments(database),
                    "--format=custom",
                    "--compress=gzip:9",
                    "--no-password",
                ],
                env=postgres_client_environment(),
                stdout=archive_output,
                check=True,
            )
            archive_output.flush()
            os.fsync(archive_output.fileno())
    except BaseException:
        archive.unlink(missing_ok=True)
        raise
    with archive.open("rb") as archive_input:
        subprocess.run(
            ["pg_restore", "--list"],
            env=postgres_client_environment(),
            stdin=archive_input,
            stdout=subprocess.DEVNULL,
            check=True,
        )


def restore_validation_archive(database: str, archive: Path) -> None:
    """Restore a complete archive into one already-created isolated database."""
    with archive.open("rb") as archive_input:
        subprocess.run(
            [
                "pg_restore",
                *postgres_connection_arguments(database),
                "--no-owner",
                "--no-privileges",
                "--exit-on-error",
            ],
            env=postgres_client_environment(),
            stdin=archive_input,
            check=True,
        )


def deterministic_snapshot(database: str) -> str:
    """Return the secret-free schema/count/sequence snapshot for comparison."""
    with SNAPSHOT_SQL.open("r", encoding="utf-8") as snapshot_input:
        result = subprocess.run(
            [
                "psql",
                *postgres_connection_arguments(database),
                "--no-psqlrc",
                "--set",
                "ON_ERROR_STOP=1",
                "--tuples-only",
                "--no-align",
                "--file",
                "-",
            ],
            env=postgres_client_environment(),
            stdin=snapshot_input,
            capture_output=True,
            text=True,
            check=True,
        )
    return result.stdout.strip()


def run_upgrade(database: str, revision: str = "head") -> None:
    """Apply revisions through the locked repository migration command."""
    subprocess.run(
        [sys.executable, "scripts/migrate.py", "upgrade", revision],
        cwd=BACKEND_ROOT,
        env=migration_environment(database),
        check=True,
    )


def seed_legacy_match(database: str) -> None:
    """Create one pre-LGA-42 match row to exercise timestamp backfill."""
    url = administration_url().set(database=database)
    engine = create_engine(url)
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO core.matches "
                    "(match_id, game_mode, game_type, queue_id, game_version, "
                    "map_id, platform, game_start_timestamp, game_end_timestamp, "
                    "game_duration) VALUES "
                    "('EUN1_VALIDATION', 'CLASSIC', 'MATCHED_GAME', 420, "
                    "'15.24.1', 11, 'EUN1', 1700000000000, 1700001800000, 1800)"
                )
            )
    finally:
        engine.dispose()


def seed_legacy_matchmaking_analyses(database: str) -> None:
    """Exercise lifecycle backfill and active-run deduplication."""
    url = administration_url().set(database=database)
    engine = create_engine(url)
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO core.players "
                    "(puuid, game_name, tag_line, platform, is_tracked) VALUES "
                    "('LIFECYCLE_VALIDATION', 'Validator', 'TEST', 'EUN1', false)"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO core.matchmaking_analyses "
                    "(puuid, created_at, started_at, completed_at, results) VALUES "
                    "('LIFECYCLE_VALIDATION', '2026-08-09T00:00:00Z', NULL, NULL, NULL), "
                    "('LIFECYCLE_VALIDATION', '2026-08-09T00:01:00Z', "
                    " '2026-08-09T00:01:01Z', NULL, NULL), "
                    "('LIFECYCLE_VALIDATION', '2026-08-09T00:02:00Z', "
                    " '2026-08-09T00:02:01Z', '2026-08-09T00:02:02Z', "
                    ' \'{"team_avg_winrate": 0.51, "enemy_avg_winrate": 0.49, '
                    '"matches_analyzed": 910}\'::jsonb), '
                    "('LIFECYCLE_VALIDATION', '2026-08-09T00:03:00Z', "
                    " '2026-08-09T00:03:01Z', '2026-08-09T00:03:02Z', "
                    ' \'{"team_avg_winrate": 0, "enemy_avg_winrate": 0, '
                    '"matches_analyzed": 0, "error": "legacy detail"}\'::jsonb)'
                )
            )
    finally:
        engine.dispose()


def observed_drift(database: str) -> list[str]:
    """Return one migrated database's divergence from the ORM metadata."""
    from app.core.models import Base

    import_every_model_module()
    engine = create_engine(administration_url().set(database=database))
    try:
        with engine.connect() as connection:
            return drift_signatures(connection, Base.metadata)
    finally:
        engine.dispose()


def validate_metadata_drift(database: str, restored_database: str) -> None:
    """Assert model/schema divergence matches the reviewed baseline exactly.

    Compares both databases so the signatures are proven reproducible rather
    than assumed: the restored copy is built by a different route (pg_dump and
    pg_restore) than the migrated source, so agreement between them means the
    baseline cannot drift with how the schema was produced.
    """
    observed = observed_drift(database)
    if observed_drift(restored_database) != observed:
        raise RuntimeError(
            "metadata drift differs between the migrated and restored databases"
        )

    unrecorded, resolved = compare_against_baseline(observed)
    if unrecorded:
        raise RuntimeError(
            "the models diverge from the migrated schema in ways no reviewed "
            "Alembic revision accounts for. Add the revision, or record a "
            f"deliberate divergence in {BASELINE_PATH.name}:\n  "
            + "\n  ".join(unrecorded)
        )
    if resolved:
        raise RuntimeError(
            f"{BASELINE_PATH.name} records divergences that no longer exist. "
            "Delete these lines — the baseline is a todo list and may only "
            "shrink:\n  " + "\n  ".join(resolved)
        )


def validate_revision(database: str) -> None:
    """Assert the locked migration runner reached the reviewed Alembic head."""
    url = administration_url().set(database=database)
    engine = create_engine(url)
    try:
        with engine.connect() as connection:
            revision = connection.execute(
                text("SELECT version_num FROM public.alembic_version")
            ).scalar_one()
    finally:
        engine.dispose()
    if revision != EXPECTED_REVISION:
        raise RuntimeError(
            f"database is at revision {revision}, expected {EXPECTED_REVISION}"
        )


async def verify_application_database_access(database: str) -> None:
    """Exercise async application access and the user-settings trigger safely."""
    original_database = os.environ.get("POSTGRES_DB")
    os.environ["POSTGRES_DB"] = database
    try:
        from app.core.database import db_manager

        async with db_manager.get_session() as session:
            user_id = (
                await session.execute(
                    text(
                        "INSERT INTO auth.users (email, password_hash, display_name) "
                        "VALUES ('migration-validation@example.invalid', 'not-a-password', 'Migration Validator') "
                        "RETURNING id"
                    )
                )
            ).scalar_one()
            settings_count = (
                await session.execute(
                    text(
                        "SELECT COUNT(*) FROM auth.user_settings WHERE user_id = :user_id"
                    ),
                    {"user_id": user_id},
                )
            ).scalar_one()
            card_preference_user_id = (
                await session.execute(
                    text(
                        "INSERT INTO auth.user_card_preferences "
                        "(user_id, card_id, version, settings) "
                        "VALUES (:user_id, 'profile.top-champions', 1, "
                        '\'{"minimum_games": 1, "minimum_win_rate": 0, '
                        '"minimum_kda": 0, "included_roles": []}\'::jsonb) '
                        "RETURNING user_id"
                    ),
                    {"user_id": user_id},
                )
            ).scalar_one()
            configured_job_types = set(
                (
                    await session.execute(
                        text("SELECT job_type FROM jobs.job_configurations")
                    )
                )
                .scalars()
                .all()
            )
            await session.rollback()
        if settings_count != 1 or card_preference_user_id != user_id:
            raise RuntimeError(
                "Application migration smoke check returned unexpected rows"
            )

        # Every job type needs a configuration row, seeded by an incremental
        # migration. Without one the type is declared, registered, runnable —
        # and never scheduled, because the scheduler iterates configurations.
        # This replaced a hardcoded row count, which a new job type satisfied
        # by simply being absent.
        from app.features.jobs.models import JobType

        unconfigured = {member.value for member in JobType} - configured_job_types
        if unconfigured:
            raise RuntimeError(
                "job types have no configuration row from any migration: "
                + ", ".join(sorted(unconfigured))
            )
    finally:
        from app.core.database import db_manager

        await db_manager.close()
        if original_database is None:
            del os.environ["POSTGRES_DB"]
        else:
            os.environ["POSTGRES_DB"] = original_database


def main() -> int:
    """Validate migration plus full backup/restore in isolated databases."""
    database = temporary_database_name()
    restored_database = temporary_database_name()
    url = administration_url()
    created = False
    restored_created = False
    try:
        validate_postgres_client_versions()
        create_database(url, database)
        created = True
        run_upgrade(database, "20260808_0003")
        seed_legacy_match(database)
        seed_legacy_matchmaking_analyses(database)
        run_upgrade(database)
        validate_revision(database)
        asyncio.run(verify_application_database_access(database))
        with tempfile.TemporaryDirectory(
            prefix="league-analysis-restore-validation-"
        ) as temporary_directory:
            archive = Path(temporary_directory) / "source.dump"
            create_restore_archive(database, archive)
            create_database(url, restored_database)
            restored_created = True
            restore_validation_archive(restored_database, archive)
            validate_revision(restored_database)
            validate_metadata_drift(database, restored_database)
            if deterministic_snapshot(restored_database) != deterministic_snapshot(
                database
            ):
                raise RuntimeError(
                    "restored PostgreSQL snapshot differs from its source"
                )
    except Exception as error:
        print(
            f"Migration validation failed: {type(error).__name__}: {error}",
            file=sys.stderr,
        )
        return 1
    finally:
        if restored_created:
            drop_database(url, restored_database)
        if created:
            drop_database(url, database)

    print(
        "Alembic baseline and disposable PostgreSQL 18 backup/restore validation passed."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
