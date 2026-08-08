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
    "RiotAPIClient",
    "RateLimiter",
    "DBRateLimiter",
    "RateLimitComponent",
    "RateLimitState",
    "COMPONENT_PRIORITY",
    "COMPONENT_MAX_WAIT",
    "RiotAPIError",
    "RateLimitError",
    "AuthenticationError",
    "ForbiddenError",
    "NotFoundError",
    "BadRequestError",
    "ServiceUnavailableError",
    "AccountDTO",
    "SummonerDTO",
    "MatchListDTO",
    "MatchDTO",
    "LeagueEntryDTO",
    "LegacyLeagueEntryDTO",
    "RiotAPIEndpoints",
]
