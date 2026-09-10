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
from sqlalchemy import URL, Connection, create_engine, inspect, text

BACKEND_ROOT = Path(__file__).resolve().parent.parent
# Every child process talks to PostgreSQL over TCP or runs Alembic against it;
# a hung server or network must fail the validator, not park it forever.
VERSION_CHECK_TIMEOUT_SECONDS = 30
SUBPROCESS_TIMEOUT_SECONDS = 600
RECONCILE_REVISION = (
    BACKEND_ROOT
    / "alembic"
    / "versions"
    / "20260816_0014_reconcile_models_and_schema.py"
)
JSONB_ABSENCE_REVISION = (
    BACKEND_ROOT / "alembic" / "versions" / "20260829_0034_jsonb_absence_is_sql_null.py"
)
# Names the one job execution seeded for revision 0034, in a column no other
# fixture writes.
_JSON_NULL_EXECUTION_MARKER = "seeded for the JSON null normalisation"
PROJECT_ROOT = BACKEND_ROOT.parent
SNAPSHOT_SQL = Path(__file__).with_name("schema_snapshot.sql")
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
            timeout=VERSION_CHECK_TIMEOUT_SECONDS,
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
                timeout=SUBPROCESS_TIMEOUT_SECONDS,
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
            timeout=SUBPROCESS_TIMEOUT_SECONDS,
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
            timeout=SUBPROCESS_TIMEOUT_SECONDS,
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
            timeout=SUBPROCESS_TIMEOUT_SECONDS,
        )
    return result.stdout.strip()


def run_upgrade(database: str, revision: str = "head") -> None:
    """Apply revisions through the locked repository migration command."""
    subprocess.run(
        [sys.executable, "scripts/migrate.py", "upgrade", revision],
        cwd=BACKEND_ROOT,
        env=migration_environment(database),
        check=True,
        timeout=SUBPROCESS_TIMEOUT_SECONDS,
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
    """Exercise lifecycle backfill, active-run dedup and the 0017 basis rewrite.

    The completed row carries 820 because that is what the pre-fix formula
    stored; seeding the post-fix 910 would leave revision 0017's `UPDATE`
    matching nothing, so emptying that revision would pass this gate unnoticed.
    """
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
                    '"matches_analyzed": 820}\'::jsonb), '
                    "('LIFECYCLE_VALIDATION', '2026-08-09T00:03:00Z', "
                    " '2026-08-09T00:03:01Z', '2026-08-09T00:03:02Z', "
                    ' \'{"team_avg_winrate": 0, "enemy_avg_winrate": 0, '
                    '"matches_analyzed": 0, "error": "legacy detail"}\'::jsonb)'
                )
            )
    finally:
        engine.dispose()


# Three keys, because the row revision 0019 must keep is not the newest one: the
# pre-0019 save path could reactivate an older row, so an inactive key can carry
# a *later* `added_at` than the active one.
_VALIDATION_ACTIVE_KEY = "RGAPI-" + "validation-active".ljust(36, "0")
_VALIDATION_STALE_KEYS = (
    ("RGAPI-" + "validation-older".ljust(36, "0"), "2026-08-01T00:00:00Z"),
    ("RGAPI-" + "validation-newer".ljust(36, "0"), "2026-08-03T00:00:00Z"),
)


def seed_riot_keys_revision_0019_must_collapse(database: str) -> None:
    """Seed the key history and the health binding revision 0019 collapses.

    `riot_credential_health` only exists from revision 0008, so this seeds at
    0018, not with the baseline fixtures. The health row's `ON DELETE SET NULL`
    binding silently becomes NULL if the revision deletes rows in the wrong order.
    """
    url = administration_url().set(database=database)
    engine = create_engine(url)
    try:
        with engine.begin() as connection:
            for key_value, added_at in _VALIDATION_STALE_KEYS:
                connection.execute(
                    text(
                        "INSERT INTO core.riot_api_keys "
                        "(key_value, is_active, added_at) "
                        "VALUES (:key_value, false, :added_at)"
                    ),
                    {"key_value": key_value, "added_at": added_at},
                )
            connection.execute(
                text(
                    "INSERT INTO core.riot_api_keys "
                    "(key_value, is_active, added_at) "
                    "VALUES (:key_value, true, '2026-08-02T00:00:00Z')"
                ),
                {"key_value": _VALIDATION_ACTIVE_KEY},
            )
            connection.execute(
                text(
                    "INSERT INTO core.riot_credential_health "
                    "(id, generation, source, db_key_id, status, evidence, "
                    " evidence_at, revision) "
                    "VALUES (1, 'validationgeneration', 'db', "
                    " (SELECT id FROM core.riot_api_keys WHERE key_value = :key_value), "
                    " 'valid', 'provider_success', '2026-08-02T00:00:00Z', 3)"
                ),
                {"key_value": _VALIDATION_ACTIVE_KEY},
            )
    finally:
        engine.dispose()


def seed_rows_revision_0022_must_empty(database: str) -> None:
    """Seed the two stand-ins for absence that revision 0022 retires.

    Both are pre-NULL stand-ins for absence: the `note` blob for a player with
    no matches, and the *string* `"None"` for an undetermined role or champion.
    Two puuids of their own, so revision 0014's de-dup leaves both rows standing.
    """
    url = administration_url().set(database=database)
    engine = create_engine(url)
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO core.players "
                    "(puuid, game_name, tag_line, platform, is_tracked) VALUES "
                    "('NO_MATCH_DATA_VALIDATION', 'Empty', 'TEST', 'EUN1', false), "
                    "('SENTINEL_VALIDATION', 'Sentinel', 'TEST', 'EUN1', false)"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO core.playstyle_analyses "
                    "(puuid, status, tags, summary_stats) VALUES "
                    "('NO_MATCH_DATA_VALIDATION', 'COMPLETED', '{}'::jsonb, "
                    ' \'{"note": "No match data available"}\'::jsonb), '
                    "('SENTINEL_VALIDATION', 'COMPLETED', '{}'::jsonb, "
                    ' \'{"main_role": "None", "most_played_champion": "None"}\'::jsonb)'
                )
            )
    finally:
        engine.dispose()


def validate_revision_0022_retired_the_absent_stand_ins(database: str) -> None:
    """Assert 0022 emptied the `note` row and nulled both `"None"` strings."""
    url = administration_url().set(database=database)
    engine = create_engine(url)
    try:
        with engine.connect() as connection:
            no_match_data = connection.execute(
                text(
                    "SELECT summary_stats FROM core.playstyle_analyses "
                    "WHERE puuid = 'NO_MATCH_DATA_VALIDATION'"
                )
            ).scalar_one()
            sentinels = connection.execute(
                text(
                    "SELECT summary_stats->>'main_role', "
                    "summary_stats->>'most_played_champion' "
                    "FROM core.playstyle_analyses WHERE puuid = 'SENTINEL_VALIDATION'"
                )
            ).one()
    finally:
        engine.dispose()
    if no_match_data is not None:
        raise RuntimeError(
            "revision 0022 left the no-match-data blob in place: "
            f"{no_match_data!r} -- the column still holds a second shape"
        )
    if sentinels != (None, None):
        raise RuntimeError(
            f'revision 0022 left a "None" string in summary_stats: {sentinels!r}'
        )


def normalised_jsonb_columns() -> tuple[tuple[str, str, str], ...]:
    """Read the columns straight out of the revision that normalises them.

    Parsed rather than copied, for the reason `tightened_participant_columns`
    is: a hand-kept second list here could drift into agreeing with nothing.
    """
    module = ast.parse(JSONB_ABSENCE_REVISION.read_text(encoding="utf-8"))
    for node in module.body:
        if not isinstance(node, ast.AnnAssign) or not isinstance(node.target, ast.Name):
            continue
        if node.target.id == "ABSENT_JSONB_COLUMNS" and node.value is not None:
            columns = ast.literal_eval(node.value)
            if not columns:
                raise RuntimeError("ABSENT_JSONB_COLUMNS in revision 0034 is empty")
            return columns
    raise RuntimeError(
        f"no ABSENT_JSONB_COLUMNS assignment in {JSONB_ABSENCE_REVISION.name}"
    )


def seed_rows_revision_0034_must_normalise(database: str) -> None:
    """Seed the JSON `null` that a `None` write used to leave in five columns.

    Raw SQL, because no writer can produce this value any more: the models now
    declare the type that sends SQL NULL. Revision 0022 runs over the seeded
    playstyle row on the way to head and cannot see it, which is the bug.
    """
    url = administration_url().set(database=database)
    engine = create_engine(url)
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO core.players (puuid, game_name, tag_line, "
                    "platform, is_tracked, profile_icon_id, summoner_level) VALUES "
                    "('JSON_NULL_VALIDATION', 'JsonNull', 'TEST', 'eun1', false, 29, 0)"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO core.playstyle_analyses "
                    "(puuid, status, tags, summary_stats) VALUES "
                    "('JSON_NULL_VALIDATION', 'COMPLETED', '{}'::jsonb, "
                    "'null'::jsonb)"
                )
            )
            connection.execute(
                text(
                    "UPDATE core.match_participants "
                    "SET runes = 'null'::jsonb, advanced_stats = 'null'::jsonb "
                    "WHERE match_id = 'EUN1_VALIDATION'"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO jobs.job_executions "
                    "(job_config_id, status, api_requests_made, records_created, "
                    " records_updated, error_message, execution_log, detailed_logs) "
                    "SELECT id, 'FAILED', 0, 0, 0, :marker, 'null'::jsonb, "
                    " 'null'::jsonb FROM jobs.job_configurations ORDER BY id LIMIT 1"
                ),
                {"marker": _JSON_NULL_EXECUTION_MARKER},
            )
    finally:
        engine.dispose()


def validate_revision_0034_left_one_absent_value(database: str) -> None:
    """Assert no column revision 0034 names still holds a JSON `null`.

    The count runs over every column the revision lists, so dropping one from
    it fails here; the seeded rows are what makes the count non-vacuous.
    """
    url = administration_url().set(database=database)
    engine = create_engine(url)
    remaining: list[str] = []
    try:
        with engine.connect() as connection:
            for schema, table, column in normalised_jsonb_columns():
                left = connection.execute(
                    text(
                        f"SELECT count(*) FROM {schema}.{table} "
                        f"WHERE {column} = 'null'::jsonb"
                    )
                ).scalar_one()
                if left:
                    remaining.append(f"{schema}.{table}.{column}: {left} row(s)")
            emptied = connection.execute(
                text(
                    "SELECT (SELECT count(*) FROM core.playstyle_analyses "
                    "  WHERE puuid = 'JSON_NULL_VALIDATION' "
                    "  AND summary_stats IS NULL), "
                    " (SELECT count(*) FROM core.match_participants "
                    "  WHERE match_id = 'EUN1_VALIDATION' "
                    "  AND runes IS NULL AND advanced_stats IS NULL), "
                    " (SELECT count(*) FROM jobs.job_executions "
                    "  WHERE error_message = :marker "
                    "  AND execution_log IS NULL AND detailed_logs IS NULL)"
                ),
                {"marker": _JSON_NULL_EXECUTION_MARKER},
            ).one()
    finally:
        engine.dispose()

    if remaining:
        raise RuntimeError(
            "revision 0034 left a JSON `null` in a column it normalises, so "
            "`IS NULL` still misses rows that hold no document: " + "; ".join(remaining)
        )
    if emptied != (1, 1, 1):
        raise RuntimeError(
            "the rows seeded for revision 0034 did not survive as SQL NULL "
            f"(playstyle, participant, execution counts: {emptied!r})"
        )


def validate_revision_0019_kept_one_bound_key(database: str) -> None:
    """Assert only the active key survived and health still points at it."""
    url = administration_url().set(database=database)
    engine = create_engine(url)
    try:
        with engine.connect() as connection:
            survivors = (
                connection.execute(text("SELECT key_value, id FROM core.riot_api_keys"))
                .tuples()
                .all()
            )
            bound = connection.execute(
                text("SELECT db_key_id FROM core.riot_credential_health WHERE id = 1")
            ).scalar_one()
    finally:
        engine.dispose()

    if [key_value for key_value, _ in survivors] != [_VALIDATION_ACTIVE_KEY]:
        raise RuntimeError(
            "revision 0019 did not collapse the key table to the active key "
            f"(survivors: {[key for key, _ in survivors]})"
        )
    if bound != survivors[0][1]:
        raise RuntimeError(
            "revision 0019 broke the credential-health binding "
            f"(db_key_id is {bound}, surviving key id is {survivors[0][1]})"
        )


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
    and the duplicate playstyle rows predate the unique index.
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


def validate_revision_0017_rewrote_the_seeded_basis(database: str) -> None:
    """Assert 0017 moved the pre-fix basis onto the current one."""
    url = administration_url().set(database=database)
    engine = create_engine(url)
    try:
        with engine.connect() as connection:
            bases = (
                connection.execute(
                    text(
                        "SELECT results->>'matches_analyzed' "
                        "FROM core.matchmaking_analyses "
                        "WHERE puuid = 'LIFECYCLE_VALIDATION' "
                        "AND results IS NOT NULL "
                        "ORDER BY created_at"
                    )
                )
                .scalars()
                .all()
            )
    finally:
        engine.dispose()
    if bases != ["910", "0"]:
        raise RuntimeError(
            "revision 0017 did not rewrite the pre-fix matchmaking basis "
            f"(expected ['910', '0'], got {bases})"
        )


def validate_revision_0030_owns_every_analysis(database: str) -> None:
    """Assert both analysis tables can no longer hold an unowned run.

    pytest has no database, so a NOT NULL, a foreign key and a partial unique
    index are all invisible to it. The check that matters is the last one: the
    active-run indexes led with `puuid` alone, so accounts could lock each other out.
    """
    url = administration_url().set(database=database)
    engine = create_engine(url)
    try:
        with engine.connect() as connection:
            for table in ("smurf_boost_analyses", "matchmaking_analyses"):
                left = connection.execute(
                    text(f"SELECT count(*) FROM core.{table}")
                ).scalar_one()
                if left:
                    raise RuntimeError(
                        f"revision 0030 left {left} unowned row(s) in {table}"
                    )

                nullable = connection.execute(
                    text(
                        "SELECT is_nullable FROM information_schema.columns "
                        "WHERE table_schema = 'core' AND table_name = :table "
                        "AND column_name = 'user_id'"
                    ),
                    {"table": table},
                ).scalar_one_or_none()
                if nullable != "NO":
                    raise RuntimeError(
                        f"core.{table}.user_id is {nullable or 'absent'}, "
                        "not a required owner"
                    )

                # `ondelete=CASCADE` is what `user_id_column` exists to say
                # once. Without it, deleting an account fails on this table.
                cascade = connection.execute(
                    text("SELECT confdeltype FROM pg_constraint WHERE conname = :name"),
                    {"name": f"fk_{table}_user_id_users"},
                ).scalar_one_or_none()
                if cascade != "c":
                    raise RuntimeError(
                        f"fk_{table}_user_id_users does not cascade "
                        f"(confdeltype {cascade!r})"
                    )

                definition = connection.execute(
                    text(
                        "SELECT indexdef FROM pg_indexes "
                        "WHERE schemaname = 'core' AND indexname = :name"
                    ),
                    {"name": f"uq_{table}_active_puuid"},
                ).scalar_one_or_none()
                if definition is None or "(user_id, puuid)" not in definition:
                    raise RuntimeError(
                        f"uq_{table}_active_puuid is not keyed by account "
                        f"and player ({definition!r})"
                    )
    finally:
        engine.dispose()


def validate_revision_0031_dropped_the_legacy_queue_ids(database: str) -> None:
    """Assert no job configuration still carries `enabled_queue_ids`.

    pytest has no database, and the key's only remaining source is the seed in
    the initial schema this database just replayed, so the fixture is free. The
    strip is a `-` against `jsonb`: on a `json` column or a NULL it does nothing.
    """
    url = administration_url().set(database=database)
    engine = create_engine(url)
    try:
        with engine.connect() as connection:
            left = connection.execute(
                text(
                    "SELECT count(*) FROM jobs.job_configurations "
                    "WHERE config_json ? 'enabled_queue_ids'"
                )
            ).scalar_one()
            if left:
                raise RuntimeError(
                    f"revision 0031 left enabled_queue_ids on {left} "
                    "job configuration(s)"
                )

            # The seeded row is the one that had it, and it must still be a
            # Match Fetcher configuration afterwards rather than a casualty.
            seeded = connection.execute(
                text(
                    "SELECT count(*) FROM jobs.job_configurations "
                    "WHERE job_type = 'MATCH_FETCHER'"
                )
            ).scalar_one()
            if seeded != 1:
                raise RuntimeError(
                    f"expected one Match Fetcher configuration, found {seeded}"
                )
    finally:
        engine.dispose()


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

    `alembic/env.py` leaves `compare_server_default` off, because it reports 127
    columns where the database has a `DEFAULT` and the model only a client-side
    `default=`. The failure that hides is the two naming *different* values.
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


# Prefix for the throwaway constraints this check adds inside a transaction it
# rolls back, chosen so it cannot collide with a real convention-generated name.
DRIFT_PROBE_PREFIX = "__drift_probe_"


def _check_constraint_definitions(
    connection: Connection, table: str, schema: str
) -> tuple[dict[str, str], dict[str, str]]:
    """Return one table's CHECK definitions as (live, probe) name -> expression.

    Both halves come out of `pg_get_constraintdef`, so both have been through
    PostgreSQL's own deparser and are directly comparable.
    """
    rows = connection.execute(
        text(
            "SELECT conname, pg_get_constraintdef(c.oid) "
            "FROM pg_constraint c "
            "JOIN pg_class t ON t.oid = c.conrelid "
            "JOIN pg_namespace n ON n.oid = t.relnamespace "
            "WHERE c.contype = 'c' AND t.relname = :table AND n.nspname = :schema"
        ),
        {"table": table, "schema": schema},
    ).all()

    live: dict[str, str] = {}
    probe: dict[str, str] = {}
    for name, definition in rows:
        # `NOT VALID` is an artefact of how the probe is added, never part of
        # what the constraint means.
        expression = definition.removesuffix(" NOT VALID")
        if name.startswith(DRIFT_PROBE_PREFIX):
            probe[name.removeprefix(DRIFT_PROBE_PREFIX)] = expression
        else:
            live[name] = expression
    return live, probe


def validate_check_constraints(database: str) -> None:
    """Assert every CHECK constraint enforces the condition its model declares.

    `alembic check` matches CHECK constraints by name and never reads the
    expression, so a condition rewritten under an unchanged name is invisible.
    Both sides go through PostgreSQL's deparser and match on expression, not name.
    """
    from sqlalchemy import CheckConstraint

    from app.core.models import Base
    from app.model_registry import import_all_models

    import_all_models()
    engine = create_engine(administration_url().set(database=database))
    disagreements: list[str] = []
    try:
        with engine.begin() as connection:
            for table in Base.metadata.sorted_tables:
                schema = table.schema or "public"
                model_checks = [
                    constraint
                    for constraint in table.constraints
                    if isinstance(constraint, CheckConstraint)
                ]
                if not model_checks:
                    continue
                for index, constraint in enumerate(model_checks):
                    connection.execute(
                        text(
                            f'ALTER TABLE "{schema}"."{table.name}" '
                            f'ADD CONSTRAINT "{DRIFT_PROBE_PREFIX}{index}" '
                            f"CHECK ({constraint.sqltext}) NOT VALID"
                        )
                    )

                live, probe = _check_constraint_definitions(
                    connection, table.name, schema
                )
                live_expressions = set(live.values())
                for index, expression in probe.items():
                    if expression in live_expressions:
                        continue
                    declared = model_checks[int(index)]
                    disagreements.append(
                        f"{schema}.{table.name}: the model declares "
                        f"{str(declared.sqltext)!r} (name {declared.name!r}), "
                        f"which normalises to {expression!r}, and no CHECK on "
                        f"the table enforces it. The table has: "
                        + "; ".join(
                            f"{name} {definition}"
                            for name, definition in sorted(live.items())
                        )
                    )
            # Nothing here is meant to survive; the probes exist only to be read.
            connection.rollback()
    finally:
        engine.dispose()

    if disagreements:
        raise RuntimeError(
            "a CHECK constraint does not enforce what its model says it does, "
            "which `alembic check` cannot see because it compares CHECK "
            "constraints by name only:\n  " + "\n  ".join(disagreements)
        )


def validate_metadata_drift(database: str, restored_database: str) -> None:
    """Assert the ORM models describe the migrated schema exactly.

    `alembic check` autogenerates against the live database and fails if it
    would emit any operation; running it through `alembic/env.py` keeps the
    runtime owned tables out. Both databases are checked, built by two routes.
    """
    for target in (database, restored_database):
        result = subprocess.run(
            [sys.executable, "-m", "alembic", "check"],
            cwd=BACKEND_ROOT,
            env=migration_environment(target),
            capture_output=True,
            text=True,
            check=False,
            timeout=SUBPROCESS_TIMEOUT_SECONDS,
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


async def verify_expired_key_turns_health_missing(database: str) -> None:
    """Drive the real credential sync over the real foreign key.

    `riot_credential_health.db_key_id` is `ON DELETE SET NULL`, so deleting an
    aged key blanks the binding as a side effect. Only a real foreign key shows
    that. The 0019 fixture is already the failing shape.
    """
    original_database = os.environ.get("POSTGRES_DB")
    os.environ["POSTGRES_DB"] = database
    try:
        from app.core.database import db_manager
        from app.core.riot_api.credential_health import (
            synchronize_riot_credential_health,
        )
        from app.model_registry import import_all_models

        # This path goes through the ORM rather than raw SQL, so the mappers
        # have to be able to resolve their relationships.
        import_all_models()

        async with db_manager.get_session() as session:
            credential, snapshot = await synchronize_riot_credential_health(session)
            remaining = (
                await session.execute(text("SELECT COUNT(*) FROM core.riot_api_keys"))
            ).scalar_one()

        if credential is not None:
            raise RuntimeError("an expired Riot key was still handed to a client")
        if snapshot.status.value != "missing":
            raise RuntimeError(
                "credential health did not fall to missing when the only key "
                f"expired (status is {snapshot.status.value!r})"
            )
        if remaining != 0:
            raise RuntimeError(
                f"the expired Riot key was not deleted ({remaining} rows remain)"
            )
        await db_manager.close()
    finally:
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
        seed_rows_revision_0022_must_empty(database)
        run_upgrade(database, "20260820_0018")
        # Before head on purpose: revision 0030 gives the analysis tables an
        # owning account, and rows seeded here have none to give, so it empties
        # them. Left after head this check would read zero rows.
        validate_revision_0017_rewrote_the_seeded_basis(database)
        seed_riot_keys_revision_0019_must_collapse(database)
        seed_rows_revision_0034_must_normalise(database)
        run_upgrade(database)
        validate_revision(database)
        validate_revision_0034_left_one_absent_value(database)
        validate_revision_0014_repaired_the_seeded_rows(database)
        validate_revision_0019_kept_one_bound_key(database)
        validate_revision_0022_retired_the_absent_stand_ins(database)
        validate_revision_0030_owns_every_analysis(database)
        validate_revision_0031_dropped_the_legacy_queue_ids(database)
        asyncio.run(verify_application_database_access(database))
        asyncio.run(verify_expired_key_turns_health_missing(database))
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
            validate_check_constraints(database)
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
