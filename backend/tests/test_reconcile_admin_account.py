"""Regression coverage for the guarded administrator reconciler."""

from __future__ import annotations

import io

import pytest

from scripts.reconcile_admin_account import (
    AdminReconciliationRefusal,
    is_loopback_address,
    is_loopback_listener_configuration,
    parse_arguments,
    read_password,
)


def test_parser_is_dry_run_by_default() -> None:
    """Mutation requires the explicit apply flag."""
    arguments = parse_arguments(
        [
            "--database",
            "league_analysis_local_dev",
            "--email",
            "admin@example.com",
            "--display-name",
            "Admin",
        ]
    )

    assert arguments.apply is False
    assert arguments.password_stdin is False


def test_parser_rejects_any_other_database() -> None:
    """The one-time account command cannot target a production database."""
    with pytest.raises(SystemExit):
        parse_arguments(
            [
                "--database",
                "league_analysis",
                "--email",
                "admin@example.com",
                "--display-name",
                "Admin",
            ]
        )


@pytest.mark.parametrize(
    "value", ["localhost", "127.0.0.1", "127.0.0.1/32", "::1", "::1/128"]
)
def test_loopback_addresses_are_accepted(value: str) -> None:
    """All supported local PostgreSQL loopback forms are allowed."""
    assert is_loopback_address(value)


@pytest.mark.parametrize("value", ["0.0.0.0", "192.168.1.2", "postgres"])
def test_non_loopback_addresses_are_rejected(value: str) -> None:
    """Remote, wildcard, and service-name targets are not local-only proof."""
    assert not is_loopback_address(value)


def test_listener_configuration_requires_only_loopback_addresses() -> None:
    """One non-loopback bind invalidates the complete listener list."""
    assert is_loopback_listener_configuration("localhost,127.0.0.1,::1")
    assert not is_loopback_listener_configuration("localhost,0.0.0.0")


def test_password_stdin_reads_without_printing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The non-interactive path consumes one hidden input line."""
    monkeypatch.setattr("sys.stdin", io.StringIO("private-value\nignored\n"))

    assert read_password(password_stdin=True) == "private-value"


def test_password_stdin_rejects_an_empty_value(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An empty input cannot result in a usable account."""
    monkeypatch.setattr("sys.stdin", io.StringIO("\n"))

    with pytest.raises(AdminReconciliationRefusal, match="must not be empty"):
        read_password(password_stdin=True)
