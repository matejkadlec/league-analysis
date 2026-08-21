#!/usr/bin/env python3
"""Create or reconcile one administrator in the verified local database.

The password is accepted only through a hidden prompt or standard input. It is
hashed with the application's normal Argon2id configuration and is never
printed or accepted as a command-line argument.
"""

from __future__ import annotations

import argparse
import asyncio
import getpass
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

from dotenv import load_dotenv
from pydantic import TypeAdapter, ValidationError
from sqlalchemy import func, select, text

BACKEND_ROOT = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_ROOT.parent

# Operational commands must use the protected configuration belonging to this
# exact worktree, even when a WSL shell retained variables from another run.
if os.getenv("ENVIRONMENT", "").lower() != "test":
    for configuration_name in (
        "POSTGRES_DB",
        "POSTGRES_USER",
        "POSTGRES_PASSWORD",
        "POSTGRES_HOST",
        "POSTGRES_PORT",
        "DEBUG",
        "ENVIRONMENT",
        "JWT_SECRET_KEY",
    ):
        os.environ.pop(configuration_name, None)
    load_dotenv(PROJECT_ROOT / ".env", override=False)

from app.core.config import get_global_settings  # noqa: E402
from app.core.database import db_manager  # noqa: E402
from app.features.auth.models import User  # noqa: E402
from app.features.auth.passwords import hash_password, verify_password  # noqa: E402
from app.features.auth.schemas import DisplayName  # noqa: E402
from app.features.auth.service import AuthService  # noqa: E402

_DISPLAY_NAME_ADAPTER: TypeAdapter[DisplayName] = TypeAdapter(DisplayName)
from scripts.local_target import (  # noqa: E402
    is_loopback_address,
    is_loopback_listener_configuration,
)

LOCAL_DATABASE = "league_analysis_local_dev"


class AdminReconciliationRefusal(RuntimeError):
    """Raised when the exact local-only mutation boundary cannot be proven."""


def parse_arguments(argv: list[str] | None = None) -> argparse.Namespace:
    """Parse the explicit local account reconciliation command."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True, choices=(LOCAL_DATABASE,))
    parser.add_argument("--email", required=True)
    parser.add_argument("--display-name", required=True)
    parser.add_argument(
        "--password-stdin",
        action="store_true",
        help="Read one password line from standard input instead of a hidden prompt.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply the idempotent reconciliation; the default is a dry run.",
    )
    return parser.parse_args(argv)


def read_password(password_stdin: bool) -> str:
    """Read a non-empty password without echoing it."""
    if password_stdin:
        password = sys.stdin.readline().rstrip("\r\n")
    else:
        password = getpass.getpass("Initial administrator password: ")
    if not password:
        raise AdminReconciliationRefusal("administrator password must not be empty")
    return password


async def verify_local_target(database: str) -> None:
    """Prove this process is attached to the exact loopback development DB."""
    settings = get_global_settings()
    if settings.environment != "dev":
        raise AdminReconciliationRefusal("ENVIRONMENT must be dev")
    if settings.postgres_db != database:
        raise AdminReconciliationRefusal(
            "--database must exactly match the protected POSTGRES_DB value"
        )
    if not is_loopback_address(settings.postgres_host):
        raise AdminReconciliationRefusal("POSTGRES_HOST must be loopback-only")

    async with db_manager.get_session() as session:
        current_database = (
            await session.execute(text("SELECT current_database()"))
        ).scalar_one()
        if current_database != database:
            raise AdminReconciliationRefusal(
                "connected database does not match the confirmed target"
            )
        listen_addresses = (
            await session.execute(text("SHOW listen_addresses"))
        ).scalar_one()
        if not is_loopback_listener_configuration(str(listen_addresses)):
            raise AdminReconciliationRefusal(
                "PostgreSQL listen_addresses is not loopback-only"
            )
        server_address = (
            await session.execute(text("SELECT inet_server_addr()::text"))
        ).scalar_one()
        if not is_loopback_address(str(server_address)):
            raise AdminReconciliationRefusal(
                "active PostgreSQL listener is not loopback-only"
            )
        required_table = (
            await session.execute(text("SELECT to_regclass('auth.users') IS NOT NULL"))
        ).scalar_one()
        if not required_table:
            raise AdminReconciliationRefusal(
                "target does not contain the auth.users application table"
            )


async def reconcile_admin(
    *, email: str, display_name: str, password: str
) -> tuple[int, bool]:
    """Create or normalize one exact administrator and verify authentication."""
    normalized_email = email.strip().lower()
    if not normalized_email or "@" not in normalized_email:
        raise AdminReconciliationRefusal("a valid administrator email is required")
    # Through the API's own type, not a second hand-rolled rule: this writes the
    # ORM directly, so a name that only passes here is one `PATCH /auth/me`
    # would refuse -- an admin who cannot re-save their own profile.
    try:
        normalized_display_name = _DISPLAY_NAME_ADAPTER.validate_python(display_name)
    except ValidationError as error:
        raise AdminReconciliationRefusal(
            "administrator display name must be 3-128 letters, marks, "
            "underscores or spaces, starting and ending on a letter"
        ) from error

    async with db_manager.get_session() as session:
        async with session.begin():
            result = await session.execute(
                select(User)
                .where(func.lower(User.email) == normalized_email)
                .order_by(User.id)
                .with_for_update()
            )
            matches = list(result.scalars())
            if len(matches) > 1:
                raise AdminReconciliationRefusal(
                    "multiple users match the normalized administrator email"
                )

            created = not matches
            password_hash = await hash_password(password)
            now = datetime.now(UTC)
            if created:
                user = User(
                    email=normalized_email,
                    display_name=normalized_display_name,
                    password_hash=password_hash,
                    is_active=True,
                    is_admin=True,
                    email_verified=True,
                    email_verified_at=now,
                    failed_login_attempts=0,
                    last_failed_login=None,
                    locked_until=None,
                )
                session.add(user)
                await session.flush()
            else:
                user = matches[0]
                user.email = normalized_email
                user.display_name = normalized_display_name
                user.password_hash = password_hash
                user.is_active = True
                user.is_admin = True
                user.email_verified = True
                user.email_verified_at = user.email_verified_at or now
                user.failed_login_attempts = 0
                user.last_failed_login = None
                user.locked_until = None
                user.updated_at = now
                await session.flush()

            user_id = user.id

        settings_count = (
            await session.execute(
                text(
                    "SELECT COUNT(*) FROM auth.user_settings WHERE user_id = :user_id"
                ),
                {"user_id": user_id},
            )
        ).scalar_one()
        if settings_count != 1:
            raise AdminReconciliationRefusal(
                "administrator does not have exactly one user_settings row"
            )

        auth_service = AuthService(session)
        authenticated = await auth_service.authenticate_user(normalized_email, password)
        if (
            authenticated is None
            or authenticated.id != user_id
            or not authenticated.is_active
            or not authenticated.is_admin
            or not authenticated.email_verified
            or not await verify_password(password, authenticated.password_hash)
        ):
            raise AdminReconciliationRefusal(
                "administrator failed the normal authentication verification path"
            )
        return user_id, created


async def async_main(arguments: argparse.Namespace) -> int:
    """Execute the dry run or guarded mutation."""
    await verify_local_target(arguments.database)
    normalized_email = arguments.email.strip().lower()

    async with db_manager.get_session() as session:
        matches = list(
            (
                await session.execute(
                    select(User.id, User.is_admin)
                    .where(func.lower(User.email) == normalized_email)
                    .order_by(User.id)
                )
            ).all()
        )
    if len(matches) > 1:
        raise AdminReconciliationRefusal(
            "multiple users match the normalized administrator email"
        )

    action = "reconcile" if matches else "create"
    print(f"Verified local target: {arguments.database}")
    print(f"Planned action: {action} one full administrator for {normalized_email}")
    if not arguments.apply:
        print("Dry run passed; use --apply to perform the reconciliation.")
        return 0

    password = read_password(arguments.password_stdin)
    user_id, created = await reconcile_admin(
        email=normalized_email,
        display_name=arguments.display_name,
        password=password,
    )
    print(
        "Administrator created and verified through normal authentication."
        if created
        else "Administrator reconciled and verified through normal authentication."
    )
    print(f"Verified administrator user ID: {user_id}")
    return 0


def main(argv: list[str] | None = None) -> int:
    """Run the secret-safe administrator command."""
    arguments = parse_arguments(argv)

    async def run_and_close() -> int:
        try:
            return await async_main(arguments)
        finally:
            await db_manager.close()

    try:
        return asyncio.run(run_and_close())
    except AdminReconciliationRefusal as error:
        print(f"Refusing administrator reconciliation: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
