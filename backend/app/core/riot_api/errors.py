"""Custom error classes for Riot API client."""

from typing import override


class RiotAPIError(Exception):
    """Base exception for Riot API errors with status code tracking."""

    def __init__(
        self,
        message: str,
        status_code: int | None = None,
        retry_after: float | None = None,
    ) -> None:
        """
        Initialize RiotAPIError.

        Args:
            message: Error message
            status_code: HTTP status code (400, 401, 403, 404, 429, 503, etc.)
            retry_after: Seconds to wait before retry (for 429 errors)
        """
        super().__init__(message)
        self.status_code: int | None = status_code
        self.retry_after: float | None = retry_after
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


# The frontend maps `code` (api-error.ts, api.ts); `message` is what direct API
# consumers see.
RIOT_API_KEY_INVALID_DETAIL = {
    "code": "RIOT_API_KEY_INVALID",
    "message": "Riot data is temporarily unavailable. Please contact an administrator.",
}


class ForbiddenError(RiotAPIError):
    """Forbidden error (403) - insufficient permissions."""

    pass


class NotFoundError(RiotAPIError):
    """Not found error (404) - resource doesn't exist."""

    pass


class ServiceUnavailableError(RiotAPIError):
    """Service unavailable (503) - Riot servers down."""

    pass


class NullResponseBodyError(RiotAPIError):
    """A 200 whose JSON body is `null` - a proxy or cache glitch, retried.

    Its own type so the retry predicate can treat it as transient without
    inventing a status code for a response that nominally succeeded.
    """

    pass


class BadRequestError(RiotAPIError):
    """Bad request (400) - invalid parameters."""

    pass


class PuuidDecryptionError(BadRequestError):
    """Bad request (400) - a stored PUUID belongs to another developer account.

    Riot encrypts PUUIDs per developer account. The type carries the condition so
    no PUUID payload travels with the error.
    """

    pass
