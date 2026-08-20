"""
Riot API client package for League of Legends API integration.

This package provides a comprehensive HTTP client for interacting with the Riot API,
including proper rate limiting, error handling, and authentication.
"""

from .client import RiotAPIClient
from .endpoints import RiotAPIEndpoints
from .errors import (
    AuthenticationError,
    BadRequestError,
    ForbiddenError,
    NotFoundError,
    PuuidDecryptionError,
    RateLimitError,
    RiotAPIError,
    ServiceUnavailableError,
)
from .models import (
    AccountDTO,
    LeagueEntryDTO,
    MatchDTO,
    MatchListDTO,
    SummonerDTO,
)
from .rate_limiter import RateLimiter

__all__ = [
    "AccountDTO",
    "AuthenticationError",
    "BadRequestError",
    "ForbiddenError",
    "LeagueEntryDTO",
    "MatchDTO",
    "MatchListDTO",
    "NotFoundError",
    "PuuidDecryptionError",
    "RateLimitError",
    "RateLimiter",
    "RiotAPIClient",
    "RiotAPIEndpoints",
    "RiotAPIError",
    "ServiceUnavailableError",
    "SummonerDTO",
]
