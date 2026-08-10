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
EXPECTED_REVISION = "20260809_0006"
EXPECTED_TABLES = 23
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
            match_timestamp_column_count = connection.execute(
                text(
                    "SELECT COUNT(*) FROM information_schema.columns "
                    "WHERE table_schema = 'core' AND table_name = 'matches' "
                    "AND column_name IN "
                    "('game_creation_timestamp', 'game_start_timestamp_source') "
                    "AND is_nullable = 'NO' AND column_default IS NULL"
                )
            ).scalar_one()
            match_timestamp_constraint_count = connection.execute(
                text(
                    "SELECT COUNT(*) FROM pg_constraint con "
                    "JOIN pg_class cls ON cls.oid = con.conrelid "
                    "JOIN pg_namespace ns ON ns.oid = cls.relnamespace "
                    "WHERE ns.nspname = 'core' "
                    "AND cls.relname = 'matches' "
                    "AND con.conname = 'ck_matches_start_timestamp_source'"
                )
            ).scalar_one()
            legacy_timestamp_row = connection.execute(
                text(
                    "SELECT game_creation_timestamp, game_start_timestamp, "
                    "game_start_timestamp_source FROM core.matches "
                    "WHERE match_id = 'EUN1_VALIDATION'"
                )
            ).one()
            matchmaking_lifecycle_column_count = connection.execute(
                text(
                    "SELECT COUNT(*) FROM information_schema.columns "
                    "WHERE table_schema = 'core' "
                    "AND table_name = 'matchmaking_analyses' "
                    "AND column_name IN ('status', 'error_code', 'error_message')"
                )
            ).scalar_one()
            matchmaking_lifecycle_constraint_count = connection.execute(
                text(
                    "SELECT COUNT(*) FROM pg_constraint con "
                    "JOIN pg_class cls ON cls.oid = con.conrelid "
                    "JOIN pg_namespace ns ON ns.oid = cls.relnamespace "
                    "WHERE ns.nspname = 'core' "
                    "AND cls.relname = 'matchmaking_analyses' "
                    "AND con.conname = 'ck_matchmaking_analyses_status_valid'"
                )
            ).scalar_one()
            matchmaking_active_index_count = connection.execute(
                text(
                    "SELECT COUNT(*) FROM pg_indexes "
                    "WHERE schemaname = 'core' "
                    "AND tablename = 'matchmaking_analyses' "
                    "AND indexname = 'uq_matchmaking_analyses_active_puuid'"
                )
            ).scalar_one()
            matchmaking_lifecycle_rows = connection.execute(
                text(
                    "SELECT status, error_code, error_message "
                    "FROM core.matchmaking_analyses "
                    "WHERE puuid = 'LIFECYCLE_VALIDATION' "
                    "ORDER BY created_at"
                )
            ).all()
            player_freshness_column_count = connection.execute(
                text(
                    "SELECT COUNT(*) FROM information_schema.columns "
                    "WHERE table_schema = 'core' AND table_name = 'players' "
                    "AND column_name IN "
                    "('profile_synced_at', 'league_synced_at', 'match_synced_at')"
                )
            ).scalar_one()
            player_context_column_count = connection.execute(
                text(
                    "SELECT COUNT(*) FROM information_schema.columns "
                    "WHERE table_schema = 'auth' "
                    "AND ((table_name = 'user_settings' "
                    "AND column_name = 'current_player_puuid') "
                    "OR (table_name = 'user_tracked_players' "
                    "AND column_name = 'last_selected_at'))"
                )
            ).scalar_one()
            legacy_player_setting_count = connection.execute(
                text(
                    "SELECT COUNT(*) FROM information_schema.columns "
                    "WHERE table_schema = 'auth' AND table_name = 'user_settings' "
                    "AND column_name IN "
                    "('save_playstyle_url', 'saved_playstyle_puuid', "
                    "'save_matchmaking_url', 'saved_matchmaking_puuid', "
                    "'save_tracked_url', 'saved_tracked_puuid')"
                )
            ).scalar_one()
            player_sync_constraint_count = connection.execute(
                text(
                    "SELECT COUNT(*) FROM pg_constraint con "
                    "JOIN pg_class cls ON cls.oid = con.conrelid "
                    "JOIN pg_namespace ns ON ns.oid = cls.relnamespace "
                    "WHERE ns.nspname = 'jobs' "
                    "AND cls.relname = 'player_sync_runs' "
                    "AND con.conname = 'ck_player_sync_runs_status_valid'"
                )
            ).scalar_one()
            player_sync_active_index_count = connection.execute(
                text(
                    "SELECT COUNT(*) FROM pg_indexes "
                    "WHERE schemaname = 'jobs' "
                    "AND tablename = 'player_sync_runs' "
                    "AND indexname = 'uq_player_sync_runs_active_puuid'"
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
        match_timestamp_column_count,
        match_timestamp_constraint_count,
        tuple(legacy_timestamp_row),
        matchmaking_lifecycle_column_count,
        matchmaking_lifecycle_constraint_count,
        matchmaking_active_index_count,
        tuple(tuple(row) for row in matchmaking_lifecycle_rows),
        player_freshness_column_count,
        player_context_column_count,
        legacy_player_setting_count,
        player_sync_constraint_count,
        player_sync_active_index_count,
    )
    expected = (
        EXPECTED_REVISION,
        EXPECTED_TABLES,
        EXPECTED_ENUMS,
        EXPECTED_TRIGGERS,
        "YES",
        2,
        1,
        (1700000000000, 1700000000000, "legacy_game_creation"),
        3,
        1,
        1,
        (
            (
                "cancelled",
                "superseded_during_migration",
                "This older unfinished analysis was replaced.",
            ),
            ("in_progress", None, None),
            ("completed", None, None),
            (
                "failed",
                "legacy_analysis_failure",
                "The analysis did not finish. Please try again.",
            ),
        ),
        3,
        2,
        0,
        1,
        1,
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
        run_upgrade(database, "20260808_0003")
        seed_legacy_match(database)
        seed_legacy_matchmaking_analyses(database)
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
