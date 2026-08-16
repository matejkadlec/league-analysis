"""
Riot API client package for League of Legends API integration.

This package provides a comprehensive HTTP client for interacting with the Riot API,
including proper rate limiting, error handling, and authentication.
"""

from .client import RiotAPIClient
from .db_rate_limiter import (
    COMPONENT_MAX_WAIT,
    COMPONENT_PRIORITY,
    DBRateLimiter,
    RateLimitComponent,
    RateLimitState,
)
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
    LegacyLeagueEntryDTO,
    MatchDTO,
    MatchListDTO,
    SummonerDTO,
)
from .rate_limiter import RateLimiter

__all__ = [
    "COMPONENT_MAX_WAIT",
    "COMPONENT_PRIORITY",
    "AccountDTO",
    "AuthenticationError",
    "BadRequestError",
    "DBRateLimiter",
    "ForbiddenError",
    "LeagueEntryDTO",
    "LegacyLeagueEntryDTO",
    "MatchDTO",
    "MatchListDTO",
    "NotFoundError",
    "PuuidDecryptionError",
    "RateLimitComponent",
    "RateLimitError",
    "RateLimitState",
    "RateLimiter",
    "RiotAPIClient",
    "RiotAPIEndpoints",
    "RiotAPIError",
    "ServiceUnavailableError",
    "SummonerDTO",
]
