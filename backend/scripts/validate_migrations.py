#!/usr/bin/env python3
"""Validate the Alembic baseline in an isolated PostgreSQL database."""

from __future__ import annotations

import asyncio
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
EXPECTED_REVISION = "20260808_0003"
EXPECTED_TABLES = 22
EXPECTED_ENUMS = 6
EXPECTED_TRIGGERS = 1

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


def run_upgrade(database: str) -> None:
    """Apply every revision through the locked repository migration command."""
    subprocess.run(
        [sys.executable, "scripts/migrate.py", "upgrade", "head"],
        cwd=BACKEND_ROOT,
        env=migration_environment(database),
        check=True,
    )


def validate_catalog(database: str) -> None:
    """Assert that the full PostgreSQL baseline, including non-ORM objects, exists."""
    original_database = os.environ.get("POSTGRES_DB")
    os.environ["POSTGRES_DB"] = database
    try:
        from app.core.config import get_settings

        database_url = get_settings().database_url.replace(
            "postgresql+asyncpg://", "postgresql+psycopg2://", 1
        )
    finally:
        if original_database is None:
            del os.environ["POSTGRES_DB"]
        else:
            os.environ["POSTGRES_DB"] = original_database

    engine = create_engine(database_url)
    try:
        with engine.connect() as connection:
            revision = connection.execute(
                text("SELECT version_num FROM public.alembic_version")
            ).scalar_one()
            table_count = connection.execute(
                text(
                    "SELECT COUNT(*) FROM information_schema.tables "
                    "WHERE table_type = 'BASE TABLE' "
                    "AND table_schema IN ('auth', 'core', 'jobs')"
                )
            ).scalar_one()
            enum_count = connection.execute(
                text(
                    "SELECT COUNT(*) FROM pg_type type "
                    "JOIN pg_namespace namespace ON namespace.oid = type.typnamespace "
                    "WHERE namespace.nspname IN ('auth', 'core', 'jobs') "
                    "AND type.typtype = 'e'"
                )
            ).scalar_one()
            trigger_count = connection.execute(
                text(
                    "SELECT COUNT(*) FROM pg_trigger trigger "
                    "JOIN pg_class class ON class.oid = trigger.tgrelid "
                    "JOIN pg_namespace namespace ON namespace.oid = class.relnamespace "
                    "WHERE namespace.nspname = 'auth' AND NOT trigger.tgisinternal"
                )
            ).scalar_one()
            league_id_nullable = connection.execute(
                text(
                    "SELECT is_nullable FROM information_schema.columns "
                    "WHERE table_schema = 'core' "
                    "AND table_name = 'player_leagues' "
                    "AND column_name = 'league_id'"
                )
            ).scalar_one()
    finally:
        engine.dispose()

    observed = (
        revision,
        table_count,
        enum_count,
        trigger_count,
        league_id_nullable,
    )
    expected = (
        EXPECTED_REVISION,
        EXPECTED_TABLES,
        EXPECTED_ENUMS,
        EXPECTED_TRIGGERS,
        "YES",
    )
    if observed != expected:
        raise RuntimeError(f"Unexpected migrated schema inventory: {observed}")


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
            job_count = (
                await session.execute(
                    text("SELECT COUNT(*) FROM jobs.job_configurations")
                )
            ).scalar_one()
            await session.rollback()
        if settings_count != 1 or card_preference_user_id != user_id or job_count != 2:
            raise RuntimeError(
                "Application migration smoke check returned unexpected rows"
            )
    finally:
        from app.core.database import db_manager

        await db_manager.close()
        if original_database is None:
            del os.environ["POSTGRES_DB"]
        else:
            os.environ["POSTGRES_DB"] = original_database


def main() -> int:
    """Create, validate, and remove one isolated migration database."""
    database = temporary_database_name()
    url = administration_url()
    created = False
    try:
        create_database(url, database)
        created = True
        run_upgrade(database)
        validate_catalog(database)
        asyncio.run(verify_application_database_access(database))
    except Exception as error:
        print(f"Migration validation failed: {type(error).__name__}", file=sys.stderr)
        return 1
    finally:
        if created:
            drop_database(url, database)

    print("Alembic baseline passed clean-database and application-access validation.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
