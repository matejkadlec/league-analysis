"""An unconfigured SMTP must refuse, not log the verification code.

Without the guard a deployment with no SMTP answers 200 and leaves the
one-time code in the container log. The sibling Join Us path raises on the
same guard.
"""

from types import SimpleNamespace
from typing import Any, cast

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.auth import mailer as mailer_module
from app.features.auth.errors import EmailChangeEmailNotConfiguredError
from app.features.auth.service import AuthService


async def test_verification_code_is_not_sent_without_smtp(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Substitute the settings at the reader, not on the service instance.

    The guard is `mailer.smtp_configured()`, which reads the `@cache`d global
    settings -- assigning to `service.settings` does not reach it. Patching
    `get_global_settings` keeps the real predicate under test.
    """
    monkeypatch.setattr(
        mailer_module,
        "get_global_settings",
        lambda: SimpleNamespace(smtp_host="", smtp_from_email=""),
    )
    service = AuthService(cast(AsyncSession, cast(Any, object())))

    with pytest.raises(EmailChangeEmailNotConfiguredError):
        await service._send_email_verification_code(
            target_email="new@example.com",
            code="123456",
        )
