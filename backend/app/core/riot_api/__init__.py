"""
Riot API client package for League of Legends API integration.

This package provides a comprehensive HTTP client for interacting with the Riot API,
including proper rate limiting, error handling, and authentication.
"""

from .client import RiotAPIClient
from .rate_limiter import RateLimiter
from .db_rate_limiter import (
    DBRateLimiter,
    RateLimitComponent,
    RateLimitState,
    COMPONENT_PRIORITY,
    COMPONENT_MAX_WAIT,
)
from .errors import (
    RiotAPIError,
    RateLimitError,
    AuthenticationError,
    ForbiddenError,
    NotFoundError,
    BadRequestError,
    ServiceUnavailableError,
)
from .models import (
    AccountDTO,
    SummonerDTO,
    MatchListDTO,
    MatchDTO,
    LeagueEntryDTO,
)
from .endpoints import RiotAPIEndpoints

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
    "RiotAPIEndpoints",
]
