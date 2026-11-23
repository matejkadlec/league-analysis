"""Regression coverage for the operator's account command."""

from __future__ import annotations

import io

import pytest

from scripts.account import (
    AccountRefusal,
    parse_arguments,
    read_password,
    validated_account,
)


def test_parser_creates_a_regular_account_by_default() -> None:
    """Administrator rights and changing an existing account are both opt-in."""
    arguments = parse_arguments(
        ["--email", "player@example.com", "--display-name", "Player"]
    )

    assert arguments.admin is False
    assert arguments.update is False
    assert arguments.password_stdin is False


def test_parser_accepts_no_password_argument() -> None:
    """A password on the command line would land in shell history and `ps`."""
    with pytest.raises(SystemExit):
        parse_arguments(
            [
                "--email",
                "player@example.com",
                "--display-name",
                "Player",
                "--password",
                "Valid-Passw0rd!",
            ]
        )


def test_password_stdin_reads_one_line(monkeypatch: pytest.MonkeyPatch) -> None:
    """The non-interactive path consumes exactly the first input line."""
    monkeypatch.setattr("sys.stdin", io.StringIO("Valid-Passw0rd!\nignored\n"))

    assert read_password(password_stdin=True) == "Valid-Passw0rd!"


def test_password_stdin_rejects_an_empty_value(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An empty input cannot result in a usable account."""
    monkeypatch.setattr("sys.stdin", io.StringIO("\n"))

    with pytest.raises(AccountRefusal, match="must not be empty"):
        read_password(password_stdin=True)


def test_prompted_passwords_must_match(monkeypatch: pytest.MonkeyPatch) -> None:
    """A typo in a hidden prompt would otherwise create an unusable account."""
    answers = iter(["Valid-Passw0rd!", "Valid-Passw0rd?"])

    def hidden_prompt(_prompt: str) -> str:
        return next(answers)

    monkeypatch.setattr("getpass.getpass", hidden_prompt)

    with pytest.raises(AccountRefusal, match="passwords differ"):
        read_password(password_stdin=False)


def test_the_email_is_normalized_like_a_login() -> None:
    """Login compares case-insensitively; the stored address is the lowered one."""
    account = validated_account(
        email="  Player@Example.COM ",
        display_name="Player",
        password="Valid-Passw0rd!",
    )

    assert account.email == "player@example.com"


def test_a_refused_password_is_named_by_rule_and_never_repeated() -> None:
    """The refusal reaches a terminal and its scrollback, so it carries no input."""
    with pytest.raises(AccountRefusal) as refusal:
        validated_account(
            email="player@example.com",
            display_name="Player",
            password="weak-but-private-value",
        )

    message = str(refusal.value)
    assert "password" in message
    assert "uppercase" in message
    assert "weak-but-private-value" not in message
