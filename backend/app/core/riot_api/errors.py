"""Custom error classes for Riot API client."""

from typing import Any, override


class RiotAPIError(Exception):
    """Base exception for Riot API errors with status code tracking."""

    def __init__(
        self,
        message: str,
        status_code: int | None = None,
        response_data: dict[str, Any] | None = None,
        retry_after: float | None = None,
        app_rate_limit: str | None = None,
        method_rate_limit: str | None = None,
    ) -> None:
        """
        Initialize RiotAPIError.

        Args:
            message: Error message
            status_code: HTTP status code (400, 401, 403, 404, 429, 503, etc.)
            response_data: Raw response data from API
            retry_after: Seconds to wait before retry (for 429 errors)
            app_rate_limit: App-level rate limit header (for 429 errors)
            method_rate_limit: Method-level rate limit header (for 429 errors)
        """
        super().__init__(message)
        self.status_code: int | None = status_code
        self.response_data: dict[str, Any] = response_data or {}
        self.retry_after: float | None = retry_after
        self.app_rate_limit: str | None = app_rate_limit
        self.method_rate_limit: str | None = method_rate_limit
        self.message: str = message

    @override
    def __str__(self) -> str:
        """Return string representation of the error."""
        if self.status_code == 429 and self.retry_after:
            return f"Rate Limit Error {self.status_code}: {self.message} (Retry after: {self.retry_after}s)"
        if self.status_code:
            return f"Riot API Error {self.status_code}: {self.message}"
        return f"Riot API Error: {self.message}"


class RateLimitError(RiotAPIError):
    """Rate limit error (429) - can be retried after cooldown."""

    pass


class AuthenticationError(RiotAPIError):
    """Authentication error (401) - invalid or expired API key."""

    pass


class ForbiddenError(RiotAPIError):
    """Forbidden error (403) - insufficient permissions."""

    pass


class NotFoundError(RiotAPIError):
    """Not found error (404) - resource doesn't exist."""

    pass


class ServiceUnavailableError(RiotAPIError):
    """Service unavailable (503) - Riot servers down."""

    pass


class BadRequestError(RiotAPIError):
    """Bad request (400) - invalid parameters."""

    pass


class PuuidDecryptionError(BadRequestError):
    """Bad request (400) - a stored PUUID belongs to another developer account.

    Riot encrypts PUUIDs per developer account, so a PUUID captured under a
    different account cannot be decrypted by the active key and every endpoint
    rejects it. The condition is carried by the exception type rather than the
    provider message so no PUUID payload travels with the error.
    """

    pass
