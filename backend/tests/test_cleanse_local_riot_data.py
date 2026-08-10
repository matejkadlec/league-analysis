"""Regression coverage for the fail-closed LGA-11 local cleanup command."""

from __future__ import annotations

import argparse
import os
import stat
import subprocess
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

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


def test_apply_requires_a_new_backup_path(tmp_path) -> None:
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


def test_resume_writers_is_explicit_and_cannot_take_a_backup(tmp_path) -> None:
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


def test_validated_backup_path_resolves_an_external_symlink(tmp_path) -> None:
    """A canonical path outside the checkout remains a valid backup location."""
    external_backup_directory = tmp_path / "backups"
    external_backup_directory.mkdir()
    backup_alias = tmp_path / "backup-alias"
    backup_alias.symlink_to(external_backup_directory, target_is_directory=True)

    assert validated_backup_path(backup_alias / "before.dump") == (
        external_backup_directory / "before.dump"
    )


def test_validated_backup_path_rejects_a_symlink_into_the_repository(tmp_path) -> None:
    """A symlinked ancestor cannot disguise a repository-contained dump."""
    repository_alias = tmp_path / "repository-alias"
    repository_alias.symlink_to(cleanup.PROJECT_ROOT, target_is_directory=True)

    with pytest.raises(LocalCleanupRefusal, match="outside the repository"):
        validated_backup_path(repository_alias / "backend" / "before.dump")


def test_validated_backup_path_refuses_a_group_or_other_writable_parent(
    tmp_path,
) -> None:
    """A renameable backup path cannot be trusted through cleanup mutation."""
    backup_directory = tmp_path / "shared-backups"
    backup_directory.mkdir()
    backup_directory.chmod(0o733)

    with pytest.raises(LocalCleanupRefusal, match="writable by group or other"):
        validated_backup_path(backup_directory / "before.dump")


def test_validated_backup_path_refuses_a_nonsticky_writable_ancestor(tmp_path) -> None:
    """A private parent is unsafe below a replaceable directory ancestor."""
    shared_directory = tmp_path / "shared-backups"
    shared_directory.mkdir()
    shared_directory.chmod(0o733)
    private_directory = shared_directory / "private"
    private_directory.mkdir(mode=0o700)

    with pytest.raises(LocalCleanupRefusal, match="ancestor"):
        validated_backup_path(private_directory / "before.dump")


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
    monkeypatch,
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
        def execute(self, statement, *_args, **_kwargs):
            query = str(statement)
            if query == "SELECT current_database()":
                return Result("league_analysis_local_dev")
            if query == "SHOW listen_addresses":
                return Result("*")
            raise AssertionError(f"unexpected query after unsafe listener: {query}")

    with pytest.raises(LocalCleanupRefusal, match="listen_addresses"):
        preflight(Connection(), settings, "league_analysis_local_dev")


def test_validate_configured_target_accepts_the_explicit_local_target(
    monkeypatch,
) -> None:
    """The pre-connection guard permits only the documented local configuration."""
    monkeypatch.setenv("ENVIRONMENT", "dev")
    settings = SimpleNamespace(
        environment="dev",
        postgres_host="localhost",
        postgres_db="league_analysis_local_dev",
    )

    validate_configured_target(settings, "league_analysis_local_dev")


def test_main_refuses_a_remote_target_before_creating_an_engine(monkeypatch) -> None:
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


def test_create_verified_backup_uses_private_permissions(tmp_path, monkeypatch) -> None:
    """pg_dump receives a pre-created owner-only archive descriptor."""
    backup_path = tmp_path / "before.dump"
    settings = SimpleNamespace(
        postgres_password="test-password",
        postgres_host="localhost",
        postgres_port=5432,
        postgres_user="postgres",
    )

    def fake_run(command, **_kwargs):
        if command[0] == "pg_dump":
            assert not any(option.startswith("--file=") for option in command)
            backup_output = _kwargs["stdout"]
            assert stat.S_IMODE(os.fstat(backup_output.fileno()).st_mode) == 0o600
            backup_output.write(b"backup")
        return subprocess.CompletedProcess(command, 0)

    original_umask = os.umask(0o022)
    try:
        monkeypatch.setattr(cleanup.subprocess, "run", fake_run)
        create_verified_backup(settings, "league_analysis_local_dev", backup_path)
    finally:
        os.umask(original_umask)

    assert stat.S_IMODE(backup_path.stat().st_mode) == 0o600


def test_create_verified_backup_corrects_a_non_private_dump(
    tmp_path, monkeypatch
) -> None:
    """An unexpectedly relaxed dump mode is corrected and re-verified."""
    backup_path = tmp_path / "before.dump"
    settings = SimpleNamespace(
        postgres_password="test-password",
        postgres_host="localhost",
        postgres_port=5432,
        postgres_user="postgres",
    )

    def fake_run(command, **_kwargs):
        if command[0] == "pg_dump":
            backup_output = _kwargs["stdout"]
            backup_output.write(b"backup")
            os.fchmod(backup_output.fileno(), 0o644)
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(cleanup.subprocess, "run", fake_run)

    create_verified_backup(settings, "league_analysis_local_dev", backup_path)

    assert stat.S_IMODE(backup_path.stat().st_mode) == 0o600


def test_create_verified_backup_refuses_an_unsecured_output_before_dump(
    tmp_path, monkeypatch
) -> None:
    """Cleanup does not start pg_dump when private output setup cannot be verified."""
    backup_path = tmp_path / "before.dump"
    settings = SimpleNamespace(
        postgres_password="test-password",
        postgres_host="localhost",
        postgres_port=5432,
        postgres_user="postgres",
    )
    invoked_commands: list[str] = []

    def fake_run(command, **_kwargs):
        invoked_commands.append(command[0])
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(cleanup.subprocess, "run", fake_run)
    monkeypatch.setattr(
        cleanup.os,
        "fchmod",
        lambda *_args: (_ for _ in ()).throw(PermissionError("read-only mode")),
    )

    with pytest.raises(LocalCleanupRefusal, match="private backup output"):
        create_verified_backup(settings, "league_analysis_local_dev", backup_path)

    assert invoked_commands == []
    assert not os.path.lexists(backup_path)


def test_create_verified_backup_refuses_a_replaced_path_without_touching_target(
    tmp_path, monkeypatch
) -> None:
    """No-follow discard never overwrites a path swapped for an attacker symlink."""
    backup_path = tmp_path / "before.dump"
    victim_path = tmp_path / "victim.txt"
    victim_path.write_bytes(b"do-not-touch")
    settings = SimpleNamespace(
        postgres_password="test-password",
        postgres_host="localhost",
        postgres_port=5432,
        postgres_user="postgres",
    )

    def fake_run(command, **_kwargs):
        if command[0] == "pg_dump":
            backup_output = _kwargs["stdout"]
            backup_output.write(b"backup")
            backup_path.unlink()
            backup_path.symlink_to(victim_path)
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(cleanup.subprocess, "run", fake_run)

    with pytest.raises(LocalCleanupRefusal, match="removal could not be verified"):
        create_verified_backup(settings, "league_analysis_local_dev", backup_path)

    assert victim_path.read_bytes() == b"do-not-touch"
    assert backup_path.is_symlink()


def test_delete_riot_data_clears_current_player_context() -> None:
    """The reset cannot leave account context pointing at deleted Riot data."""

    class Result:
        rowcount = 3

    class Connection:
        def __init__(self) -> None:
            self.queries: list[str] = []

        def execute(self, statement, *_args, **_kwargs) -> Result:
            self.queries.append(str(statement))
            return Result()

    connection = Connection()

    deleted = delete_riot_data(connection)

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

        def execute(self, statement, *_args, **_kwargs) -> None:
            self.query = str(statement)

    connection = Connection()

    lock_cleanup_tables(connection)

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

        def execute(self, statement, *_args, **_kwargs) -> Result:
            self.query = str(statement)
            return Result()

    connection = Connection()

    assert active_regular_riot_writer_execution_ids(connection) == [7, 11]
    assert "MATCH_FETCHER" in connection.query
    assert "PLAYER_UPDATER" in connection.query
    assert "execution_type" in connection.query
    assert "'REGULAR'" in connection.query
    assert "'RUNNING'" in connection.query
    assert "'PAUSED'" in connection.query


def test_active_regular_riot_writer_refuses_cleanup(monkeypatch) -> None:
    """The destructive transaction stops before backup when a writer is active."""
    monkeypatch.setattr(
        cleanup,
        "active_regular_riot_writer_execution_ids",
        lambda _connection: [9],
    )

    with pytest.raises(LocalCleanupRefusal, match="9"):
        refuse_active_regular_riot_writers(object())


def test_riot_writer_maintenance_queries_change_only_writer_configurations() -> None:
    """Apply and explicit resume use narrow JSONB changes on reviewed job types."""

    class Result:
        rowcount = 2

        def scalars(self):
            return SimpleNamespace(all=lambda: ["MATCH_FETCHER", "PLAYER_UPDATER"])

    class Connection:
        def __init__(self) -> None:
            self.queries: list[str] = []

        def execute(self, statement, *_args, **_kwargs) -> Result:
            self.queries.append(str(statement))
            return Result()

    connection = Connection()

    assert enable_riot_writer_maintenance_mode(connection) == 2
    assert resume_riot_writers(connection) == 2

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
        def scalars(self):
            return SimpleNamespace(all=lambda: updated_job_types)

    class Connection:
        def execute(self, *_args, **_kwargs) -> Result:
            return Result()

    with pytest.raises(LocalCleanupRefusal, match="exactly one Match Fetcher"):
        enable_riot_writer_maintenance_mode(Connection())


def test_normalize_qa_accounts_preserves_revoked_access_tokens(monkeypatch) -> None:
    """Resetting fixture sessions must not reactivate an already revoked JWT."""

    class Result:
        def scalar_one(self) -> int:
            return 1

    class Connection:
        def __init__(self) -> None:
            self.queries: list[str] = []

        def execute(self, statement, *_args, **_kwargs) -> Result:
            self.queries.append(str(statement))
            return Result()

    monkeypatch.setattr(
        cleanup.AuthService,
        "get_password_hash",
        staticmethod(lambda _password: "test-password-hash"),
    )
    connection = Connection()
    target = Preflight(
        admin_id=1,
        client_id=2,
        server_address="127.0.0.1",
        listen_addresses="localhost",
    )

    assert not normalize_qa_accounts(connection, target)

    cleanup_queries = "\n".join(connection.queries)
    assert 'DELETE FROM auth."refresh_tokens"' in cleanup_queries
    assert 'DELETE FROM auth."email_change_requests"' in cleanup_queries
    assert "revoked_access_tokens" not in cleanup_queries


def test_apply_locks_tables_before_creating_the_backup(tmp_path, monkeypatch) -> None:
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

        def __exit__(self, *_args) -> None:
            return None

    class Engine:
        def connect(self) -> Context:
            return Context()

        def begin(self) -> Context:
            return Context()

        def dispose(self) -> None:
            events.append("dispose")

    monkeypatch.setattr(cleanup, "get_settings", lambda: settings)
    monkeypatch.setattr(cleanup, "validate_configured_target", lambda *_args: None)
    monkeypatch.setattr(cleanup, "connection_url", lambda *_args: "test-url")
    monkeypatch.setattr(cleanup, "create_engine", lambda _url: Engine())
    monkeypatch.setattr(cleanup, "preflight", lambda *_args: target)
    monkeypatch.setattr(cleanup, "table_counts", lambda *_args: {})
    monkeypatch.setattr(cleanup, "print_plan", lambda *_args: None)
    monkeypatch.setattr(
        cleanup, "lock_cleanup_tables", lambda _connection: events.append("lock")
    )
    monkeypatch.setattr(
        cleanup,
        "refuse_active_regular_riot_writers",
        lambda _connection: events.append("refuse-active-writers"),
    )
    monkeypatch.setattr(
        cleanup,
        "enable_riot_writer_maintenance_mode",
        lambda _connection: events.append("enable-maintenance"),
    )
    monkeypatch.setattr(
        cleanup,
        "create_verified_backup",
        lambda *_args: events.append("backup"),
    )
    monkeypatch.setattr(
        cleanup, "delete_riot_data", lambda _connection: events.append("delete") or {}
    )
    monkeypatch.setattr(cleanup, "normalize_qa_accounts", lambda *_args: False)
    monkeypatch.setattr(cleanup, "verify_after_cleanup", lambda *_args: None)

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
