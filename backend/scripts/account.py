#!/usr/bin/env python3
"""Create or update one account in the database this process is configured for.

The application has no registration route, so this is how an account is made.
The password comes from a hidden prompt, or one line of standard input with
`--password-stdin`; it is never an argument and never printed.
"""

from __future__ import annotations

import argparse
import asyncio
import getpass
import sys
from datetime import UTC, datetime

from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_global_settings
from app.core.database import db_manager
from app.features.auth.schemas import UserCreate
from app.features.auth.service import AuthService
from app.features.auth.users.passwords import hash_password


class AccountRefusal(RuntimeError):
    """Raised when the requested account cannot be created or updated."""


def parse_arguments(argv: list[str] | None = None) -> argparse.Namespace:
    """Parse the account command; nothing secret is accepted here."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--email", required=True)
    parser.add_argument("--display-name", required=True)
    parser.add_argument(
        "--admin",
        action="store_true",
        help="Make the account an administrator; without it the account is a regular user.",
    )
    parser.add_argument(
        "--update",
        action="store_true",
        help="Change an existing account (password, name, role, lockout) instead of creating one.",
    )
    parser.add_argument(
        "--password-stdin",
        action="store_true",
        help="Read one password line from standard input instead of a hidden prompt.",
    )
    return parser.parse_args(argv)


def read_password(password_stdin: bool) -> str:
    """Read a non-empty password without echoing it."""
    if password_stdin:
        password = sys.stdin.readline().rstrip("\r\n")
    else:
        password = getpass.getpass("Password: ")
        if getpass.getpass("Repeat the password: ") != password:
            raise AccountRefusal("the two passwords differ")
    if not password:
        raise AccountRefusal("the password must not be empty")
    return password


def validated_account(*, email: str, display_name: str, password: str) -> UserCreate:
    """Apply the API's own account rules, reporting a refusal without its input."""
    try:
        return UserCreate(
            email=email.strip().lower(), display_name=display_name, password=password
        )
    except ValidationError as error:
        # Only the field and the rule: pydantic's own rendering repeats the
        # rejected input, which for the password field is the password.
        reasons = "; ".join(
            f"{'.'.join(str(part) for part in issue['loc'])}: {issue['msg']}"
            for issue in error.errors(include_input=False, include_url=False)
        )
        raise AccountRefusal(reasons) from None


async def save_account(
    session: AsyncSession,
    *,
    account: UserCreate,
    is_admin: bool,
    update_existing: bool,
) -> tuple[int, bool]:
    """Create or update the account and verify it through the login path.

    Returns the user ID and whether the account was created.
    """
    auth_service = AuthService(session)
    existing = await auth_service.get_user_by_email_case_insensitive(account.email)
    if existing is not None and not update_existing:
        raise AccountRefusal(
            "an account with this email already exists; pass --update to change it"
        )
    if existing is None and update_existing:
        raise AccountRefusal("no account has this email; omit --update to create it")

    if existing is None:
        user = await auth_service.create_user(account)
    else:
        user = existing
        user.display_name = account.display_name
        user.password_hash = await hash_password(account.password)
        user.failed_login_attempts = 0
        user.last_failed_login = None
        user.locked_until = None
        # A changed password must end the sessions the old one opened.
        await auth_service.revoke_all_refresh_tokens_for_user(user.id)
    user.is_active = True
    user.is_admin = is_admin
    user.email_verified = True
    user.email_verified_at = user.email_verified_at or datetime.now(UTC)
    await session.commit()

    authenticated = await auth_service.authenticate_user(
        account.email, account.password
    )
    if (
        authenticated is None
        or authenticated.id != user.id
        or not authenticated.is_active
        or authenticated.is_admin != is_admin
    ):
        raise AccountRefusal("the saved account failed the normal login check")
    return user.id, existing is None


async def async_main(arguments: argparse.Namespace) -> int:
    """Read the password, save the account and report without secrets."""
    settings = get_global_settings()
    print(
        f"Target: database {settings.postgres_db} on {settings.postgres_host} "
        f"(ENVIRONMENT={settings.environment})"
    )
    account = validated_account(
        email=arguments.email,
        display_name=arguments.display_name,
        password=read_password(arguments.password_stdin),
    )
    async with db_manager.get_session() as session:
        user_id, created = await save_account(
            session,
            account=account,
            is_admin=arguments.admin,
            update_existing=arguments.update,
        )
    role = "administrator" if arguments.admin else "regular user"
    action = "created" if created else "updated"
    print(f"Account {action}: {account.email} (ID {user_id}, {role}); login verified.")
    return 0


def main(argv: list[str] | None = None) -> int:
    """Run the account command."""
    arguments = parse_arguments(argv)

    async def run_and_close() -> int:
        try:
            return await async_main(arguments)
        finally:
            await db_manager.close()

    try:
        return asyncio.run(run_and_close())
    except AccountRefusal as error:
        print(f"Refusing the account change: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
