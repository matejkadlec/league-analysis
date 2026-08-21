"""Regression coverage for the guarded administrator reconciler."""

from __future__ import annotations

import io

import pytest

from scripts.reconcile_admin_account import (
    AdminReconciliationRefusal,
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
