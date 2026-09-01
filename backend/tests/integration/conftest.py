"""A migrated throwaway PostgreSQL for the claims a mock cannot answer.

A compiled statement cannot show an unbacked ON CONFLICT target, JSONB NULL
semantics, a missing `ALTER TYPE`, or a server default; these fixtures can.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import URL, create_engine, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.features.auth.users.models import User
from app.features.players.models import Player

BACKEND_ROOT = Path(__file__).resolve().parents[2]
MIGRATION_TIMEOUT_SECONDS = 600

# `PlayerResponse` pins the Riot PUUID at exactly 78 characters, so a short
# stand-in fails validation rather than the behaviour under test.
INTEGRATION_PUUID = "INTEGRATION-PUUID-".ljust(78, "0")

# The name is interpolated into DDL, which cannot take a bind parameter, so it
# must pass this `fullmatch` first.
DATABASE_NAME_PATTERN = r"lga_integration_tests_[0-9a-f]{32}"

NO_DATABASE_SKIP = (
    "no PostgreSQL answers at POSTGRES_HOST:POSTGRES_PORT. Run this tier "
    "against the gate's database with "
    "`docker compose -f compose.gate.yml run --rm gate -b`."
)


def _required_environment(name: str) -> str:
    """Read a required connection setting, skipping when it is absent."""
    value = os.environ.get(name)
    if value is None or value.strip() == "":
        pytest.skip(NO_DATABASE_SKIP)
    return value


def _connection_url(driver: str, database: str) -> URL:
    """Build a URL for `database` from the configured connection settings."""
    return URL.create(
        driver,
        username=_required_environment("POSTGRES_USER"),
        password=_required_environment("POSTGRES_PASSWORD"),
        host=_required_environment("POSTGRES_HOST"),
        port=int(_required_environment("POSTGRES_PORT")),
        database=database,
    )


def _temporary_database_name() -> str:
    """Return a unique name constrained to this tier's private namespace."""
    name = f"lga_integration_tests_{uuid4().hex}"
    if re.fullmatch(DATABASE_NAME_PATTERN, name) is None:
        raise ValueError("Generated an invalid temporary database name")
    return name


def _quoted_identifier(identifier: str) -> str:
    """Quote a generated database identifier after enforcing its exact shape."""
    if re.fullmatch(DATABASE_NAME_PATTERN, identifier) is None:
        raise ValueError("Refusing to use a non-integration database name")
    return f'"{identifier}"'


def _create_database(url: URL, database: str) -> None:
    """Create the private, empty database this session writes to."""
    engine = create_engine(url, isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as connection:
            connection.execute(text(f"CREATE DATABASE {_quoted_identifier(database)}"))
    finally:
        engine.dispose()


def _drop_database(url: URL, database: str) -> None:
    """Terminate only this tier's own sessions and remove its database."""
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
                text(f"DROP DATABASE IF EXISTS {_quoted_identifier(database)}")
            )
    finally:
        engine.dispose()


def _run_migrations(database: str) -> None:
    """Build the schema from the revisions, which are its only authority.

    A subprocess because Alembic's `env.py` calls `fileConfig`, which would
    reconfigure logging for every other test in this process.
    """
    environment = os.environ.copy()
    environment["POSTGRES_DB"] = database
    subprocess.run(
        [sys.executable, "scripts/migrate.py", "upgrade", "head"],
        cwd=BACKEND_ROOT,
        env=environment,
        check=True,
        capture_output=True,
        timeout=MIGRATION_TIMEOUT_SECONDS,
    )


@pytest.fixture(scope="session")
def migrated_database() -> Iterator[str]:
    """Create one throwaway database, migrate it to head, and drop it after.

    Skips rather than fails when nothing answers, so `./test.sh -b` outside
    compose stays usable on a host with no PostgreSQL.
    """
    administration_url = _connection_url("postgresql+psycopg2", "postgres")
    database = _temporary_database_name()
    try:
        _create_database(administration_url, database)
    except OperationalError:
        pytest.skip(NO_DATABASE_SKIP)
    try:
        _run_migrations(database)
        yield database
    finally:
        _drop_database(administration_url, database)


@pytest.fixture
async def database_session(migrated_database: str) -> AsyncIterator[AsyncSession]:
    """A session inside an outer transaction that is always rolled back.

    `create_savepoint` turns the application's own `commit()` into a savepoint
    release, so no test can see another test's writes.
    """
    engine = create_async_engine(
        _connection_url("postgresql+asyncpg", migrated_database), poolclass=NullPool
    )
    connection = await engine.connect()
    transaction = await connection.begin()
    session = AsyncSession(
        bind=connection,
        join_transaction_mode="create_savepoint",
        expire_on_commit=False,
        autoflush=False,
    )
    try:
        yield session
    finally:
        await session.close()
        await transaction.rollback()
        await connection.close()
        await engine.dispose()


@pytest.fixture
async def stored_player(database_session: AsyncSession) -> Player:
    """One `core.players` row every foreign key in these tests can point at."""
    player = Player(
        puuid=INTEGRATION_PUUID,
        game_name="Integration",
        tag_line="TEST",
        platform="eun1",
        profile_icon_id=29,
        summoner_level=30,
    )
    database_session.add(player)
    await database_session.flush()
    return player


@pytest.fixture
async def stored_user(database_session: AsyncSession) -> User:
    """One `auth.users` row for the per-viewer tables under test."""
    user = User(
        email="integration@example.com",
        password_hash="not-a-real-hash",
        display_name="Integration",
    )
    database_session.add(user)
    await database_session.flush()
    return user
