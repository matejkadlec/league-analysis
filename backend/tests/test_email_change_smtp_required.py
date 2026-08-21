"""An unconfigured SMTP must refuse, not log the verification code.

This path used to `logger.warning(..., code=code)` and return, after which
the caller wrote `pending_email`, the code hash and the expiry and committed
-- so a deployment with no SMTP answered 200 and left the one-time code in
the container log. The sibling Join Us path has always raised on the same
guard.
"""

from typing import Any, cast

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.auth.service import (
    AuthService,
    EmailChangeEmailNotConfiguredError,
)


async def test_verification_code_is_not_sent_without_smtp() -> None:
    service = AuthService(cast(AsyncSession, cast(Any, object())))
    service.settings = service.settings.model_copy(
        update={"smtp_host": "", "smtp_from_email": ""}
    )

    with pytest.raises(EmailChangeEmailNotConfiguredError):
        await service._send_email_verification_code(
            target_email="new@example.com",
            code="123456",
        )
