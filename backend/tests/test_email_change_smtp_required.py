"""An unconfigured SMTP must refuse, not log the verification code.

This path used to `logger.warning(..., code=code)` and return, after which
the caller wrote `pending_email`, the code hash and the expiry and committed
-- so a deployment with no SMTP answered 200 and left the one-time code in
the container log. The sibling Join Us path has always raised on the same
guard.
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
    settings -- so assigning to `service.settings` does not reach it, and a
    test that did would pass on any host that simply has no SMTP configured,
    the guard deleted or not. Patching `get_global_settings` inside `mailer`
    keeps the real `smtp_host and smtp_from_email` predicate under test.
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
