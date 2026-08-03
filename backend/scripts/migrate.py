#!/usr/bin/env python3
"""Run Alembic migrations through one PostgreSQL advisory lock."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from alembic.config import Config
from sqlalchemy import create_engine, text

from alembic import command
from app.core.config import get_settings

BACKEND_ROOT = Path(__file__).resolve().parent.parent
MIGRATION_LOCK_KEY = 812_219_604_746_203


def synchronous_database_url() -> str:
    """Return a sync driver URL without printing any secret-bearing values."""
    return get_settings().database_url.replace(
        "postgresql+asyncpg://", "postgresql+psycopg2://", 1
    )


def alembic_config() -> Config:
    """Load the repository's Alembic configuration."""
    return Config(str(BACKEND_ROOT / "alembic.ini"))


def run_migration_command(command_name: str, revision: str) -> None:
    """Hold an advisory lock for the full Alembic operation."""
    engine = create_engine(synchronous_database_url(), pool_pre_ping=True)
    try:
        with engine.connect() as connection:
            connection.execute(
                text("SELECT pg_advisory_lock(:key)"), {"key": MIGRATION_LOCK_KEY}
            )
            try:
                config = alembic_config()
                config.attributes["connection"] = connection
                if command_name == "upgrade":
                    command.upgrade(config, revision)
                elif command_name == "stamp":
                    command.stamp(config, revision)
                else:
                    command.current(config)
                connection.commit()
            except Exception:
                connection.rollback()
                raise
            finally:
                connection.execute(
                    text("SELECT pg_advisory_unlock(:key)"), {"key": MIGRATION_LOCK_KEY}
                )
    finally:
        engine.dispose()


def parse_arguments() -> argparse.Namespace:
    """Parse the narrow non-destructive migration command surface."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("upgrade", "current", "stamp"))
    parser.add_argument(
        "revision",
        nargs="?",
        default="head",
        help="Alembic revision for upgrade/stamp; defaults to head.",
    )
    return parser.parse_args()


def main() -> int:
    arguments = parse_arguments()
    try:
        run_migration_command(arguments.command, arguments.revision)
    except Exception as error:
        print(f"Migration command failed: {type(error).__name__}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
