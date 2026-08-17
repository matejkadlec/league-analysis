#!/usr/bin/env python3
"""Validate the Alembic baseline in an isolated PostgreSQL database."""

from __future__ import annotations

import ast
import asyncio
import os
import re
import subprocess
import sys
import tempfile
from enum import Enum
from pathlib import Path
from uuid import uuid4

from dotenv import load_dotenv
from migration_contract import EXPECTED_ALEMBIC_HEAD
from sqlalchemy import URL, create_engine, inspect, text

BACKEND_ROOT = Path(__file__).resolve().parent.parent
RECONCILE_REVISION = (
    BACKEND_ROOT
    / "alembic"
    / "versions"
    / "20260816_0014_reconcile_models_and_schema.py"
)
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


def tightened_participant_columns() -> tuple[str, ...]:
    """Read the column list straight out of the revision that tightens them.

    Parsed rather than imported: a revision file is not on the import path, and
    copying the 24 names here would let the fixture and the revision drift into
    agreeing about nothing.
    """
    module = ast.parse(RECONCILE_REVISION.read_text(encoding="utf-8"))
    for node in module.body:
        if not isinstance(node, ast.AnnAssign) or not isinstance(node.target, ast.Name):
            continue
        if node.target.id == "NOT_NULL_COLUMNS" and node.value is not None:
            columns = ast.literal_eval(node.value)
            if not columns:
                raise RuntimeError("NOT_NULL_COLUMNS in revision 0014 is empty")
            return columns
    raise RuntimeError(f"no NOT_NULL_COLUMNS assignment in {RECONCILE_REVISION.name}")


def seed_rows_revision_0014_must_repair(database: str) -> None:
    """Seed the two shapes of legacy row that revision 0014 repairs.

    Both operations 0014 performs on data are conditional on data nobody can
    produce any more: the NULL counters predate the columns getting a default,
    and the duplicate playstyle rows predate the unique index. Without a row of
    each here, the revision's `UPDATE` and `DELETE` run against nothing and the
    gate would pass just as happily if they were deleted.
    """
    url = administration_url().set(database=database)
    engine = create_engine(url)
    columns = tightened_participant_columns()
    nulled = ", ".join(columns)
    nulls = ", ".join(["NULL"] * len(columns))
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO core.match_participants "
                    "(match_id, participant_id, puuid, game_name, tag_line, "
                    "team_id, champion_id, champion_name, champion_level, win, "
                    f"remake, kills, deaths, assists, item0, item1, item2, "
                    f"item3, item4, item5, trinket, {nulled}) VALUES "
                    "('EUN1_VALIDATION', 1, 'LIFECYCLE_VALIDATION', 'Validator', "
                    "'TEST', 100, 1, 'Annie', 18, true, false, 0, 0, 0, 0, 0, 0, "
                    f"0, 0, 0, 0, {nulls})"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO core.playstyle_analyses "
                    "(puuid, status, tags, summary_stats) VALUES "
                    "('LIFECYCLE_VALIDATION', 'COMPLETED', '{}'::jsonb, "
                    ' \'{"note": "older duplicate"}\'::jsonb), '
                    "('LIFECYCLE_VALIDATION', 'COMPLETED', '{}'::jsonb, "
                    ' \'{"note": "newest wins"}\'::jsonb)'
                )
            )
    finally:
        engine.dispose()


def validate_revision_0014_repaired_the_seeded_rows(database: str) -> None:
    """Assert 0014 backfilled the NULL counters and kept the newest analysis."""
    url = administration_url().set(database=database)
    engine = create_engine(url)
    try:
        with engine.connect() as connection:
            vision_score = connection.execute(
                text(
                    "SELECT vision_score FROM core.match_participants "
                    "WHERE match_id = 'EUN1_VALIDATION' AND participant_id = 1"
                )
            ).scalar_one()
            surviving = (
                connection.execute(
                    text(
                        "SELECT summary_stats->>'note' FROM core.playstyle_analyses "
                        "WHERE puuid = 'LIFECYCLE_VALIDATION'"
                    )
                )
                .scalars()
                .all()
            )
    finally:
        engine.dispose()
    if vision_score != 0:
        raise RuntimeError(
            f"revision 0014 left a NULL counter unrepaired: vision_score={vision_score}"
        )
    if surviving != ["newest wins"]:
        raise RuntimeError(
            "revision 0014 did not reduce the duplicate playstyle analyses to "
            f"the newest row: {surviving}"
        )


def _python_default_literal(column: object) -> object | None:
    """Render a column's Python-side default, or None when it has none."""
    default = getattr(column, "default", None)
    if default is None or default.is_callable or default.is_sequence:
        return None
    return default.arg


def _rendered_default(value: object) -> str:
    """Spell a Python default the way PostgreSQL prints the same constant."""
    # `{True: ...}[0]` would hit the True key, because bool and int share a
    # hash. Booleans therefore have to be tested before anything numeric.
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, Enum):
        return str(value.value)
    return str(value)


def validate_column_defaults(database: str) -> None:
    """Assert no column's DEFAULT disagrees with the model's own default.

    `alembic/env.py` leaves `compare_server_default` off, because turning it on
    reports 127 columns where the database carries a `DEFAULT` and the model
    declares only a client-side `default=`. That is a difference in where the
    value is written, not in what it is, and closing it would mean restating
    every one of those defaults in the models.

    The failure that difference could hide is the one checked here: the two
    sides naming *different* values, so a row written by hand in psql and a row
    written through the ORM disagree. All 128 comparable columns agreed when
    this check was added.
    """
    from app.core.models import Base
    from app.model_registry import import_all_models

    # The same explicit import list `alembic/env.py` uses, so this check and
    # `alembic check` always see the identical set of tables.
    import_all_models()
    url = administration_url().set(database=database)
    engine = create_engine(url)
    try:
        inspector = inspect(engine)
        disagreements: list[str] = []
        for table in Base.metadata.sorted_tables:
            reflected = {
                column["name"]: column
                for column in inspector.get_columns(table.name, schema=table.schema)
            }
            for column in table.columns:
                info = reflected.get(column.name)
                if info is None or info.get("default") is None:
                    continue
                python_default = _python_default_literal(column)
                if python_default is None:
                    continue
                database_default = str(info["default"]).split("::")[0].strip("'")
                if database_default != _rendered_default(python_default):
                    disagreements.append(
                        f"{table.schema}.{table.name}.{column.name}: "
                        f"database {info['default']!r}, model {python_default!r}"
                    )
    finally:
        engine.dispose()

    if disagreements:
        raise RuntimeError(
            "a column's DEFAULT disagrees with the model's own default, so a "
            "hand-written INSERT and an ORM INSERT would store different "
            "values:\n  " + "\n  ".join(disagreements)
        )


def validate_metadata_drift(database: str, restored_database: str) -> None:
    """Assert the ORM models describe the migrated schema exactly.

    `alembic check` autogenerates against the live database and fails if it
    would emit any operation, so a model edited without a revision is caught
    here. It runs through `alembic/env.py`, which is what keeps the runtime
    owned tables (APScheduler's job store, `alembic_version`) out of the
    comparison — reimplementing that filter here would let the two disagree.

    Both databases are checked. The restored copy is built by a different route
    (pg_dump and pg_restore) than the migrated source, so agreement between them
    means the result cannot vary with how the schema was produced.
    """
    for target in (database, restored_database):
        result = subprocess.run(
            [sys.executable, "-m", "alembic", "check"],
            cwd=BACKEND_ROOT,
            env=migration_environment(target),
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(
                "the models no longer describe the migrated schema. Add the "
                "Alembic revision that closes the gap:\n"
                + (result.stdout + result.stderr).strip()
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
        seed_rows_revision_0014_must_repair(database)
        run_upgrade(database)
        validate_revision(database)
        validate_revision_0014_repaired_the_seeded_rows(database)
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
            validate_column_defaults(database)
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
