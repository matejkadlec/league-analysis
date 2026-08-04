"""Regression coverage for the fail-closed LGA-11 local cleanup command."""

from __future__ import annotations

import argparse
import os
import stat
import subprocess
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from scripts import cleanse_local_riot_data as cleanup
from scripts.cleanse_local_riot_data import (
    PRESERVED_TABLES,
    RIOT_DATA_TABLES,
    LocalCleanupRefusal,
    create_verified_backup,
    is_local_host,
    is_loopback_address,
    is_loopback_listener_configuration,
    parse_arguments,
    preflight,
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
    """pg_dump creates the before-cleanup archive with an owner-only umask."""
    backup_path = tmp_path / "before.dump"
    settings = SimpleNamespace(
        postgres_password="test-password",
        postgres_host="localhost",
        postgres_port=5432,
        postgres_user="postgres",
    )

    def fake_run(command, **_kwargs):
        if command[0] == "pg_dump":
            dump_path = Path(
                next(option[7:] for option in command if option.startswith("--file="))
            )
            descriptor = os.open(dump_path, os.O_CREAT | os.O_WRONLY, 0o666)
            os.write(descriptor, b"backup")
            os.close(descriptor)
        return subprocess.CompletedProcess(command, 0)

    original_umask = os.umask(0o022)
    try:
        monkeypatch.setattr(cleanup.subprocess, "run", fake_run)
        create_verified_backup(settings, "league_analysis_local_dev", backup_path)
    finally:
        os.umask(original_umask)

    assert stat.S_IMODE(backup_path.stat().st_mode) == 0o600


def test_create_verified_backup_rejects_a_non_private_dump(
    tmp_path, monkeypatch
) -> None:
    """An unexpectedly relaxed dump mode aborts the cleanup before mutation."""
    backup_path = tmp_path / "before.dump"
    settings = SimpleNamespace(
        postgres_password="test-password",
        postgres_host="localhost",
        postgres_port=5432,
        postgres_user="postgres",
    )

    def fake_run(command, **_kwargs):
        if command[0] == "pg_dump":
            dump_path = Path(
                next(option[7:] for option in command if option.startswith("--file="))
            )
            descriptor = os.open(dump_path, os.O_CREAT | os.O_WRONLY, 0o666)
            os.write(descriptor, b"backup")
            os.close(descriptor)
            os.chmod(dump_path, 0o644)
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(cleanup.subprocess, "run", fake_run)

    with pytest.raises(LocalCleanupRefusal, match="private 0600"):
        create_verified_backup(settings, "league_analysis_local_dev", backup_path)


def test_cleanup_plan_includes_every_riot_data_category() -> None:
    """The reviewed deletion order covers data and user tracking mappings."""
    assert RIOT_DATA_TABLES[0] == ("auth", "user_tracked_players")
    assert set(RIOT_DATA_TABLES) == {
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
