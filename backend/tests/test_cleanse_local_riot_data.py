"""Regression coverage for the fail-closed LGA-11 local cleanup command."""

from __future__ import annotations

import argparse

import pytest

from scripts.cleanse_local_riot_data import (
    PRESERVED_TABLES,
    RIOT_DATA_TABLES,
    is_local_host,
    is_loopback_address,
    parse_arguments,
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
