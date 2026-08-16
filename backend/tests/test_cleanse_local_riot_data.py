"""Regression coverage for the fail-closed LGA-11 local cleanup command."""

from __future__ import annotations

import argparse
import os
import stat
import subprocess
from collections.abc import Callable
from pathlib import Path
from types import SimpleNamespace
from typing import IO, cast
from unittest.mock import Mock

import pytest
from sqlalchemy import Connection as SAConnection
from sqlalchemy.sql import Executable

from app.core.config import Settings
from scripts import cleanse_local_riot_data as cleanup
from scripts.cleanse_local_riot_data import (
    PRESERVED_TABLES,
    RIOT_DATA_TABLES,
    LocalCleanupRefusal,
    Preflight,
    active_regular_riot_writer_execution_ids,
    create_verified_backup,
    delete_riot_data,
    enable_riot_writer_maintenance_mode,
    is_local_host,
    is_loopback_address,
    is_loopback_listener_configuration,
    lock_cleanup_tables,
    normalize_qa_accounts,
    parse_arguments,
    preflight,
    refuse_active_regular_riot_writers,
    resume_riot_writers,
    validate_configured_target,
    validated_backup_path,
    validated_database_name,
)


@pytest.mark.parametrize("value", ["league_analysis_local_dev", "a1", "local_2"])
def test_validated_database_name_accepts_simple_postgres_names(value: str) -> None:
    """The operator can only target a normal unquoted PostgreSQL database name."""
    assert validated_database_name(value) == value


@pytest.mark.parametrize("value", ["", "LeagueAnalysis", "local-dev", "local;drop"])
def test_validated_database_name_rejects_unsafe_names(value: str) -> None:
    """Database targeting rejects SQL syntax and mixed-case ambiguity."""
    with pytest.raises(argparse.ArgumentTypeError):
        validated_database_name(value)


@pytest.mark.parametrize("host", ["localhost", "127.0.0.1", "::1", "[::1]"])
def test_is_local_host_accepts_loopback_hosts(host: str) -> None:
    """Configured connections are limited to unambiguous loopback host names."""
    assert is_local_host(host)


@pytest.mark.parametrize("host", ["db.internal", "10.0.0.8", "0.0.0.0", ""])
def test_is_local_host_rejects_non_loopback_hosts(host: str) -> None:
    """A remote or wildcard host cannot pass the local cleanup guard."""
    assert not is_local_host(host)


@pytest.mark.parametrize("address", ["127.0.0.1/32", "::1/128"])
def test_is_loopback_address_accepts_postgresql_listener_addresses(
    address: str,
) -> None:
    """PostgreSQL's CIDR-formatted loopback addresses are accepted."""
    assert is_loopback_address(address)


@pytest.mark.parametrize("address", ["10.0.0.1/24", "0.0.0.0/0", "not-an-address"])
def test_is_loopback_address_rejects_remote_listener_addresses(address: str) -> None:
    """A remote database listener cannot pass the local cleanup guard."""
    assert not is_loopback_address(address)


def test_default_mode_is_read_only() -> None:
    """A normal invocation cannot mutate a database by accident."""
    arguments = parse_arguments(["--database", "league_analysis_local_dev"])
    assert not arguments.apply
    assert arguments.backup_path is None


def test_apply_requires_a_new_backup_path(tmp_path: Path) -> None:
    """The destructive mode requires an explicit backup destination."""
    with pytest.raises(SystemExit):
        parse_arguments(["--database", "league_analysis_local_dev", "--apply"])

    backup_path = tmp_path / "local-before-lga-11.dump"
    arguments = parse_arguments(
        [
            "--database",
            "league_analysis_local_dev",
            "--apply",
            "--backup-path",
            str(backup_path),
        ]
    )
    assert validated_backup_path(arguments.backup_path) == backup_path


def test_resume_writers_is_explicit_and_cannot_take_a_backup(tmp_path: Path) -> None:
    """Resuming ingestion is a separate, deliberately guarded operation."""
    arguments = parse_arguments(
        ["--database", "league_analysis_local_dev", "--resume-writers"]
    )
    assert arguments.resume_writers
    assert not arguments.apply

    with pytest.raises(SystemExit):
        parse_arguments(
            [
                "--database",
                "league_analysis_local_dev",
                "--resume-writers",
                "--backup-path",
                str(tmp_path / "before.dump"),
            ]
        )


def test_validated_backup_path_resolves_an_external_symlink(tmp_path: Path) -> None:
    """A canonical path outside the checkout remains a valid backup location."""
    external_backup_directory = tmp_path / "backups"
    external_backup_directory.mkdir()
    backup_alias = tmp_path / "backup-alias"
    backup_alias.symlink_to(external_backup_directory, target_is_directory=True)

    assert validated_backup_path(backup_alias / "before.dump") == (
        external_backup_directory / "before.dump"
    )


def test_validated_backup_path_rejects_a_symlink_into_the_repository(
    tmp_path: Path,
) -> None:
    """A symlinked ancestor cannot disguise a repository-contained dump."""
    repository_alias = tmp_path / "repository-alias"
    repository_alias.symlink_to(cleanup.PROJECT_ROOT, target_is_directory=True)

    with pytest.raises(LocalCleanupRefusal, match="outside the repository"):
        validated_backup_path(repository_alias / "backend" / "before.dump")


@pytest.mark.parametrize(
    "listen_addresses", ["localhost", "127.0.0.1", "127.0.0.1, ::1"]
)
def test_loopback_listener_configuration_accepts_only_loopback_addresses(
    listen_addresses: str,
) -> None:
    """Local PostgreSQL bind configurations retain the cleanup boundary."""
    assert is_loopback_listener_configuration(listen_addresses)


@pytest.mark.parametrize(
    "listen_addresses", ["", "*", "0.0.0.0", "127.0.0.1, *", "db.internal"]
)
def test_loopback_listener_configuration_rejects_shared_bind_addresses(
    listen_addresses: str,
) -> None:
    """Wildcard and remote PostgreSQL listeners are never a local-only target."""
    assert not is_loopback_listener_configuration(listen_addresses)


def test_preflight_refuses_a_wildcard_postgresql_listener_before_table_access(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The server bind configuration, not just this connection, must be loopback."""
    monkeypatch.setenv("ENVIRONMENT", "dev")
    settings = SimpleNamespace(
        environment="dev",
        postgres_host="localhost",
        postgres_db="league_analysis_local_dev",
    )

    class Result:
        def __init__(self, value: str) -> None:
            self.value = value

        def scalar_one(self) -> str:
            return self.value

    class Connection:
        def execute(
            self, statement: Executable, *_args: object, **_kwargs: object
        ) -> Result:
            query = str(statement)
            if query == "SELECT current_database()":
                return Result("league_analysis_local_dev")
            if query == "SHOW listen_addresses":
                return Result("*")
            raise AssertionError(f"unexpected query after unsafe listener: {query}")

    with pytest.raises(LocalCleanupRefusal, match="listen_addresses"):
        preflight(
            cast(SAConnection, Connection()),
            cast(Settings, settings),
            "league_analysis_local_dev",
        )


def test_validate_configured_target_accepts_the_explicit_local_target(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The pre-connection guard permits only the documented local configuration."""
    monkeypatch.setenv("ENVIRONMENT", "dev")
    settings = SimpleNamespace(
        environment="dev",
        postgres_host="localhost",
        postgres_db="league_analysis_local_dev",
    )

    validate_configured_target(cast(Settings, settings), "league_analysis_local_dev")


def test_main_refuses_a_remote_target_before_creating_an_engine(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A dry run cannot connect when configuration names a shared host."""
    monkeypatch.setenv("ENVIRONMENT", "dev")
    settings = SimpleNamespace(
        environment="dev",
        postgres_host="db.internal",
        postgres_db="league_analysis_local_dev",
    )
    engine_factory = Mock()
    monkeypatch.setattr(cleanup, "get_settings", lambda: settings)
    monkeypatch.setattr(cleanup, "create_engine", engine_factory)

    assert cleanup.main(["--database", "league_analysis_local_dev"]) == 1
    engine_factory.assert_not_called()


def test_create_verified_backup_uses_private_permissions(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """pg_dump receives a pre-created owner-only archive descriptor."""
    backup_path = tmp_path / "before.dump"
    settings = SimpleNamespace(
        postgres_password="test-password",
        postgres_host="localhost",
        postgres_port=5432,
        postgres_user="postgres",
    )

    def fake_run(
        command: list[str],
        *,
        stdout: IO[bytes] | None = None,
        **_kwargs: object,
    ) -> subprocess.CompletedProcess[bytes]:
        if command[0] == "pg_dump":
            assert not any(option.startswith("--file=") for option in command)
            assert stdout is not None
            assert stat.S_IMODE(os.fstat(stdout.fileno()).st_mode) == 0o600
            stdout.write(b"backup")
        return subprocess.CompletedProcess[bytes](command, 0)

    original_umask = os.umask(0o022)
    try:
        monkeypatch.setattr(cleanup.subprocess, "run", fake_run)
        create_verified_backup(
            cast(Settings, settings), "league_analysis_local_dev", backup_path
        )
    finally:
        os.umask(original_umask)

    assert stat.S_IMODE(backup_path.stat().st_mode) == 0o600


def test_delete_riot_data_clears_current_player_context() -> None:
    """The reset cannot leave account context pointing at deleted Riot data."""

    class Result:
        rowcount = 3

    class Connection:
        def __init__(self) -> None:
            self.queries: list[str] = []

        def execute(
            self, statement: Executable, *_args: object, **_kwargs: object
        ) -> Result:
            self.queries.append(str(statement))
            return Result()

    connection = Connection()

    deleted = delete_riot_data(cast(SAConnection, connection))

    settings_update = next(
        query for query in connection.queries if "UPDATE auth.user_settings" in query
    )
    assert "current_player_puuid = NULL" in settings_update
    assert deleted["auth.user_settings_current_player"] == 3


def test_lock_cleanup_tables_blocks_writers_and_allows_backup_reads() -> None:
    """The lock covers each cleanup mutation without blocking pg_dump reads."""

    class Connection:
        def __init__(self) -> None:
            self.query = ""

        def execute(
            self, statement: Executable, *_args: object, **_kwargs: object
        ) -> None:
            self.query = str(statement)

    connection = Connection()

    lock_cleanup_tables(cast(SAConnection, connection))

    assert "IN SHARE ROW EXCLUSIVE MODE" in connection.query
    assert '"auth"."user_settings"' in connection.query
    assert '"jobs"."job_configurations"' in connection.query
    assert '"jobs"."job_executions"' in connection.query
    assert '"auth"."revoked_access_tokens"' not in connection.query


def test_active_regular_riot_writer_query_excludes_test_runs() -> None:
    """Only a real writer can repopulate the tables that cleanup deletes."""

    class Result:
        def scalars(self) -> Result:
            return self

        def all(self) -> list[int]:
            return [7, 11]

    class Connection:
        def __init__(self) -> None:
            self.query = ""

        def execute(
            self, statement: Executable, *_args: object, **_kwargs: object
        ) -> Result:
            self.query = str(statement)
            return Result()

    connection = Connection()

    assert active_regular_riot_writer_execution_ids(cast(SAConnection, connection)) == [
        7,
        11,
    ]
    assert "MATCH_FETCHER" in connection.query
    assert "PLAYER_UPDATER" in connection.query
    assert "execution_type" in connection.query
    assert "'REGULAR'" in connection.query
    assert "'RUNNING'" in connection.query
    assert "'PAUSED'" in connection.query


def test_active_regular_riot_writer_refuses_cleanup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The destructive transaction stops before backup when a writer is active."""

    def fake_active_execution_ids(_connection: SAConnection) -> list[int]:
        return [9]

    monkeypatch.setattr(
        cleanup,
        "active_regular_riot_writer_execution_ids",
        fake_active_execution_ids,
    )

    with pytest.raises(LocalCleanupRefusal, match="9"):
        refuse_active_regular_riot_writers(cast(SAConnection, object()))


def test_riot_writer_maintenance_queries_change_only_writer_configurations() -> None:
    """Apply and explicit resume use narrow JSONB changes on reviewed job types."""

    class Result:
        rowcount = 2

        def scalars(self) -> SimpleNamespace:
            return SimpleNamespace(all=lambda: ["MATCH_FETCHER", "PLAYER_UPDATER"])

    class Connection:
        def __init__(self) -> None:
            self.queries: list[str] = []

        def execute(
            self, statement: Executable, *_args: object, **_kwargs: object
        ) -> Result:
            self.queries.append(str(statement))
            return Result()

    connection = Connection()

    assert enable_riot_writer_maintenance_mode(cast(SAConnection, connection)) == 2
    assert resume_riot_writers(cast(SAConnection, connection)) == 2

    enable_query, resume_query = connection.queries
    assert "jsonb_set" in enable_query
    assert "riot_maintenance_mode" in enable_query
    assert "MATCH_FETCHER" in enable_query
    assert "PLAYER_UPDATER" in enable_query
    assert "RETURNING job_type::text" in enable_query
    assert "- 'riot_maintenance_mode'" in resume_query


@pytest.mark.parametrize(
    "updated_job_types",
    [
        [],
        ["MATCH_FETCHER"],
        ["PLAYER_UPDATER"],
        ["MATCH_FETCHER", "MATCH_FETCHER"],
        ["PLAYER_UPDATER", "PLAYER_UPDATER"],
        ["MATCH_FETCHER", "PLAYER_UPDATER", "MATCH_FETCHER"],
    ],
)
def test_riot_writer_maintenance_refuses_missing_or_duplicate_writer_types(
    updated_job_types: list[str],
) -> None:
    """Cleanup requires exactly one configuration for each regular writer type."""

    class Result:
        def scalars(self) -> SimpleNamespace:
            return SimpleNamespace(all=lambda: updated_job_types)

    class Connection:
        def execute(self, *_args: object, **_kwargs: object) -> Result:
            return Result()

    with pytest.raises(LocalCleanupRefusal, match="exactly one Match Fetcher"):
        enable_riot_writer_maintenance_mode(cast(SAConnection, Connection()))


def test_normalize_qa_accounts_preserves_revoked_access_tokens(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Resetting fixture sessions must not reactivate an already revoked JWT."""

    class Result:
        def scalar_one(self) -> int:
            return 1

    class Connection:
        def __init__(self) -> None:
            self.queries: list[str] = []

        def execute(
            self, statement: Executable, *_args: object, **_kwargs: object
        ) -> Result:
            self.queries.append(str(statement))
            return Result()

    def fake_password_hash(_password: str) -> str:
        return "test-password-hash"

    monkeypatch.setattr(
        cleanup.AuthService,
        "get_password_hash",
        staticmethod(fake_password_hash),
    )
    connection = Connection()
    target = Preflight(
        admin_id=1,
        client_id=2,
        server_address="127.0.0.1",
        listen_addresses="localhost",
    )

    assert not normalize_qa_accounts(cast(SAConnection, connection), target)

    cleanup_queries = "\n".join(connection.queries)
    assert 'DELETE FROM auth."refresh_tokens"' in cleanup_queries
    assert 'DELETE FROM auth."email_change_requests"' in cleanup_queries
    assert "revoked_access_tokens" not in cleanup_queries


def test_apply_locks_tables_before_creating_the_backup(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Every cleanup mutation is protected by the same pre-backup write lock."""
    events: list[str] = []
    settings = SimpleNamespace()
    target = Preflight(
        admin_id=1,
        client_id=2,
        server_address="127.0.0.1",
        listen_addresses="localhost",
    )

    class Context:
        def __enter__(self) -> Context:
            return self

        def __exit__(self, *_args: object) -> None:
            return None

    class Engine:
        def connect(self) -> Context:
            return Context()

        def begin(self) -> Context:
            return Context()

        def dispose(self) -> None:
            events.append("dispose")

    def ignore_arguments(*_args: object) -> None:
        return None

    def fake_connection_url(*_args: object) -> str:
        return "test-url"

    def fake_create_engine(_url: object) -> Engine:
        return Engine()

    def fake_preflight(*_args: object) -> Preflight:
        return target

    def empty_table_counts(*_args: object) -> dict[str, int]:
        return {}

    def record_event(name: str) -> Callable[[object], None]:
        def record(_connection: object) -> None:
            events.append(name)

        return record

    def record_backup(*_args: object) -> None:
        events.append("backup")

    def record_delete(_connection: object) -> dict[str, int]:
        events.append("delete")
        return {}

    def fake_normalize_qa_accounts(*_args: object) -> bool:
        return False

    monkeypatch.setattr(cleanup, "get_settings", lambda: settings)
    monkeypatch.setattr(cleanup, "validate_configured_target", ignore_arguments)
    monkeypatch.setattr(cleanup, "connection_url", fake_connection_url)
    monkeypatch.setattr(cleanup, "create_engine", fake_create_engine)
    monkeypatch.setattr(cleanup, "preflight", fake_preflight)
    monkeypatch.setattr(cleanup, "table_counts", empty_table_counts)
    monkeypatch.setattr(cleanup, "print_plan", ignore_arguments)
    monkeypatch.setattr(cleanup, "lock_cleanup_tables", record_event("lock"))
    monkeypatch.setattr(
        cleanup,
        "refuse_active_regular_riot_writers",
        record_event("refuse-active-writers"),
    )
    monkeypatch.setattr(
        cleanup,
        "enable_riot_writer_maintenance_mode",
        record_event("enable-maintenance"),
    )
    monkeypatch.setattr(cleanup, "create_verified_backup", record_backup)
    monkeypatch.setattr(cleanup, "delete_riot_data", record_delete)
    monkeypatch.setattr(cleanup, "normalize_qa_accounts", fake_normalize_qa_accounts)
    monkeypatch.setattr(cleanup, "verify_after_cleanup", ignore_arguments)

    assert (
        cleanup.main(
            [
                "--database",
                "league_analysis_local_dev",
                "--apply",
                "--backup-path",
                str(tmp_path / "before.dump"),
            ]
        )
        == 0
    )
    assert (
        events.index("lock")
        < events.index("refuse-active-writers")
        < events.index("enable-maintenance")
        < events.index("backup")
        < events.index("delete")
    )


def test_cleanup_plan_includes_every_riot_data_category() -> None:
    """The reviewed deletion order covers data and user tracking mappings."""
    assert RIOT_DATA_TABLES[:2] == (
        ("jobs", "player_sync_runs"),
        ("auth", "user_tracked_players"),
    )
    assert set(RIOT_DATA_TABLES) == {
        ("jobs", "player_sync_runs"),
        ("auth", "user_tracked_players"),
        ("core", "match_timelines"),
        ("core", "match_participants"),
        ("core", "matches"),
        ("core", "player_leagues"),
        ("core", "matchmaking_analyses"),
        ("core", "playstyle_analyses"),
        ("core", "players"),
    }
    assert ("jobs", "job_configurations") in PRESERVED_TABLES
    assert ("jobs", "job_executions") in PRESERVED_TABLES
