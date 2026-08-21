"""Authentication feature exceptions.

One module so the router, the service, and the tests agree on where the
vocabulary lives; every class here is part of the HTTP error contract the
router translates.
"""

from datetime import datetime


class AccountLockedError(Exception):
    """Raised when a user account is temporarily locked after failed logins."""

    def __init__(self, locked_until: datetime):
        self.locked_until = locked_until
        super().__init__("Account is temporarily locked")


class CaptchaRequiredError(Exception):
    """Raised when a login attempt must provide a CAPTCHA token."""


class CaptchaVerificationError(Exception):
    """Raised when a CAPTCHA token is missing, invalid, or cannot be verified."""


class EmailChangeLockedError(Exception):
    """Raised when email-change actions are temporarily locked for a user."""

    def __init__(self, locked_until: datetime):
        self.locked_until = locked_until
        super().__init__("Email change is temporarily locked")


class EmailAlreadyRegisteredError(Exception):
    """Raised when the target email is already used by another account."""


class EmailUnchangedError(Exception):
    """Raised when a user requests to change to the currently active email."""


class InvalidEmailVerificationCodeError(Exception):
    """Raised when an email verification code does not match."""

    def __init__(self, attempts_remaining: int):
        self.attempts_remaining = attempts_remaining
        super().__init__("Verification code is incorrect")


class EmailVerificationCodeExpiredError(Exception):
    """Raised when the verification code is no longer valid."""


class EmailVerificationRequestNotFoundError(Exception):
    """Raised when there is no pending email verification request."""


class InvalidCurrentPasswordError(Exception):
    """Raised when the submitted current password does not match."""


class JoinUsCaptchaRequiredError(Exception):
    """Raised when Join Us form submission requires CAPTCHA but none is provided."""


class JoinUsCaptchaVerificationError(Exception):
    """Raised when Join Us CAPTCHA verification fails."""


class JoinUsEmailNotConfiguredError(Exception):
    """Raised when SMTP is not configured for Join Us form delivery."""


class EmailChangeEmailNotConfiguredError(Exception):
    """Raised when SMTP is not configured for email-change verification."""


class JoinUsEmailDeliveryError(Exception):
    """Raised when Join Us form email delivery fails."""


class JoinUsBodyTooShortError(Exception):
    """Raised when a regular Join Us submission does not meet min body length."""


class JoinUsRateLimitExceededError(Exception):
    """Raised when regular Join Us submissions exceed per-hour IP limit."""

    def __init__(self, retry_after_seconds: int):
        self.retry_after_seconds = retry_after_seconds
        super().__init__("Join Us submission rate limit exceeded")
