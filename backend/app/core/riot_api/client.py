"""Riot API HTTP client with proper rate limiting, error handling, and authentication."""

import asyncio
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Union

import httpx
import structlog

from .constants import MatchType, Platform, QueueType, Region
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

logger = structlog.get_logger(__name__)


@dataclass
class APICallRecord:
    """Record of an individual API call."""

    endpoint: str  # Template like "/lol/match/v5/matches/{matchId}"
    region: str
    params: Dict[str, Any] = field(
        default_factory=dict
    )  # e.g., {"matchId": "EUN1_123"}
    timestamp: str = ""  # ISO timestamp


class RiotAPIClient:
    """Comprehensive Riot API client with rate limiting and error handling."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        region: Optional[Region] = None,
        platform: Optional[Platform] = None,
        enable_logging: bool = True,
        request_callback: Optional[Callable[[str, int], None]] = None,
    ):
        """
        Initialize Riot API client.

        Args:
            api_key: Riot API key (uses config if None)
            region: Default region for regional endpoints
            platform: Default platform for platform endpoints
            enable_logging: Enable request/response logging
            request_callback: Optional callback for tracking API requests (metric_name, count)
        """
        if not api_key:
            raise ValueError(
                "api_key is required - retrieve from database using get_riot_api_key()"
            )

        self.api_key = api_key
        # Default to EUN region if not specified
        self.region = region or Region("europe")
        self.platform = platform or Platform("eun1")
        self.enable_logging = enable_logging
        self.request_callback = request_callback

        # Initialize components
        self.rate_limiter = RateLimiter()
        self.endpoints = RiotAPIEndpoints(self.region, self.platform)

        # HTTP session
        self.session = None
        self._session_lock = asyncio.Lock()

        # Track individual API calls for job logging
        self._api_calls: List[APICallRecord] = []

    async def __aenter__(self):
        """Async context manager entry."""
        await self.start_session()
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: object | None,
    ) -> None:
        """Async context manager exit."""
        await self.close()

    async def start_session(self) -> None:
        """Start the httpx session."""
        if self.session is None or self.session.is_closed:
            async with self._session_lock:
                if self.session is None or self.session.is_closed:
                    headers = {
                        "X-Riot-Token": self.api_key,
                        "Content-Type": "application/json",
                        "User-Agent": "RiotAPI-SmurfDetector/1.0",
                    }

                    timeout = httpx.Timeout(
                        connect=5.0, read=25.0, write=10.0, pool=30.0
                    )
                    limits = httpx.Limits(
                        max_keepalive_connections=20, max_connections=5
                    )

                    self.session = httpx.AsyncClient(
                        headers=headers, timeout=timeout, limits=limits
                    )

                    logger.info(
                        "Riot API client session started",
                        region=self._enum_str(self.region),
                        platform=self._enum_str(self.platform),
                        api_key_prefix="[REDACTED]" if self.api_key else "None",
                    )

    async def close(self) -> None:
        """Close the httpx session."""
        if self.session and not self.session.is_closed:
            await self.session.aclose()
            logger.info("Riot API client session closed")

    def get_api_calls(self) -> List[APICallRecord]:
        """Get all recorded API calls for this session."""
        return self._api_calls.copy()

    def _record_api_call(
        self, endpoint_template: str, region: str, params: Dict[str, Any]
    ) -> None:
        """Record an API call for job logging."""
        from datetime import datetime, timezone

        self._api_calls.append(
            APICallRecord(
                endpoint=endpoint_template,
                region=region.upper() if region else "UNKNOWN",
                params=params,
                timestamp=datetime.now(timezone.utc).isoformat(),
            )
        )

    def _raise_client_error_if_needed(self, status: int) -> None:
        """Raise specific RiotAPIError subclass for client errors."""
        if status == 400:
            raise BadRequestError("Invalid request parameters", status_code=status)
        elif status == 401:
            raise AuthenticationError("Invalid API key", status_code=status)
        elif status == 403:
            raise ForbiddenError("Access forbidden", status_code=status)
        elif status == 404:
            raise NotFoundError("Resource not found", status_code=status)

    @staticmethod
    def _normalize_headers(headers: dict[str, Any]) -> dict[str, str]:
        """Normalize HTTP header keys to lowercase for case-insensitive lookups."""
        return {str(k).lower(): str(v) for k, v in headers.items()}

    @staticmethod
    def _parse_retry_after(headers: dict[str, str], default_seconds: int = 120) -> int:
        """Parse Retry-After header with a safe fallback."""
        raw_retry_after = headers.get("retry-after")
        if raw_retry_after is None:
            return default_seconds

        try:
            retry_after = int(float(raw_retry_after))
        except TypeError, ValueError:
            return default_seconds

        return max(retry_after, 1)

    def _handle_rate_limit(
        self, headers: dict[str, str], attempt: int, max_retries: int
    ) -> tuple[bool, int]:
        """Handle rate limit (429) with retry logic."""
        retry_after = self._parse_retry_after(headers)

        # Log the detailed rate limit headers for debugging
        app_limit = headers.get("x-app-rate-limit", "unknown")
        app_count = headers.get("x-app-rate-limit-count", "unknown")
        method_limit = headers.get("x-method-rate-limit", "unknown")
        logger.warning(
            "Rate limit hit",
            retry_after=retry_after,
            app_limit=app_limit,
            current_usage=app_count,
            method_limit=method_limit,
        )

        if attempt < max_retries:
            return (True, retry_after)
        raise RateLimitError(
            "Rate limit exceeded",
            status_code=429,
            retry_after=retry_after,
            app_rate_limit=headers.get("x-app-rate-limit"),
            method_rate_limit=headers.get("x-method-rate-limit"),
        )

    def _handle_server_error(
        self, status: int, attempt: int, max_retries: int
    ) -> tuple[bool, int]:
        """Handle server errors (5xx) with exponential backoff."""
        if attempt < max_retries:
            return (True, 2**attempt)
        if status == 503:
            raise ServiceUnavailableError("Service unavailable", status_code=status)
        else:
            raise RiotAPIError(f"Server error {status}", status_code=status)

    async def _handle_http_error_status(
        self, status: int, headers: dict[str, str], attempt: int, max_retries: int
    ) -> tuple[bool, int]:
        """
        Handle HTTP error status codes.

        Returns:
            Tuple of (should_retry, sleep_seconds)

        Raises:
            RiotAPIError: For non-retryable errors
        """
        # Non-retryable client errors
        self._raise_client_error_if_needed(status)

        # Rate limit - retryable
        if status == 429:
            return self._handle_rate_limit(headers, attempt, max_retries)

        # Server errors - retryable with exponential backoff
        if status >= 500:
            return self._handle_server_error(status, attempt, max_retries)

        return (False, 0)

    async def _execute_single_request(
        self,
        url: str,
        method: str,
        params: Optional[Dict[str, Any]],
        data: Optional[Dict[str, Any]],
        attempt: int,
        max_retries: int,
    ) -> Any:
        """Execute a single HTTP request with error handling."""
        if self.session is None:
            raise RiotAPIError("Session not initialized")

        response = await self.session.request(method, url, params=params, json=data)
        response_headers = self._normalize_headers(dict(response.headers))

        # Track all API requests (successful or failed) - every HTTP call counts
        if self.request_callback:
            self.request_callback("requests_made", 1)

        try:
            self.rate_limiter.update_limits(response_headers, url, method)

            # Handle error status codes
            if response.status_code != 200:
                should_retry, sleep_seconds = await self._handle_http_error_status(
                    response.status_code, response_headers, attempt, max_retries
                )
                if should_retry:
                    await asyncio.sleep(sleep_seconds)
                    return None  # Signal to retry

            response_data = response.json()
            return response_data
        finally:
            await response.aclose()

    async def _make_request(
        self,
        url: str,
        method: str = "GET",
        params: Optional[Dict[str, Any]] = None,
        data: Optional[Dict[str, Any]] = None,
        retry_on_failure: bool = True,
    ) -> Any:
        """
        Make HTTP request with rate limiting and retry logic.

        Args:
            url: Request URL
            method: HTTP method
            params: Query parameters
            data: Request body data
            retry_on_failure: Retry on transient failures

        Returns:
            Response data as dictionary or list

        Raises:
            RiotAPIError: For API errors
        """
        await self.start_session()

        if self.session is None:
            raise RiotAPIError("Session not initialized")

        # Rate limiting
        await self.rate_limiter.wait_if_needed(url, method)

        # Retry loop
        max_retries = 3 if retry_on_failure else 0
        last_error = None

        for attempt in range(max_retries + 1):
            try:
                result = await self._execute_single_request(
                    url, method, params, data, attempt, max_retries
                )
                if result is not None:
                    return result
            except (httpx.RequestError, asyncio.TimeoutError) as e:
                last_error = e
                if attempt < max_retries:
                    await asyncio.sleep(2**attempt)

        raise RiotAPIError(f"Request failed: {str(last_error)}")

    def _extract_endpoint_path(self, url: str) -> str:
        """Extract endpoint path from URL for rate limiting."""
        stripped = url.replace("https://", "").replace("http://", "")
        parts = stripped.split("/", 1)
        if len(parts) == 2:
            return parts[1]
        return stripped

    @staticmethod
    def _enum_str(value: Union[Region, Platform, str]) -> str:
        """Extract string value from enum or return as-is."""
        if isinstance(value, Enum):
            return str(value.value)
        return value

    # Account endpoints
    async def get_account_by_riot_id(
        self, game_name: str, tag_line: str, region: Optional[Region] = None
    ) -> AccountDTO:
        """Get account by Riot ID (gameName#tagLine)."""
        used_region = region or self.region
        self._record_api_call(
            "/riot/account/v1/accounts/by-riot-id/{gameName}/{tagLine}",
            self._enum_str(used_region),
            {"gameName": game_name, "tagLine": tag_line},
        )
        url = self.endpoints.account_by_riot_id(game_name, tag_line, region)
        response = await self._make_request(url)
        return AccountDTO(**response)

    async def get_account_by_puuid(
        self, puuid: str, region: Optional[Region] = None
    ) -> AccountDTO:
        """Get account by PUUID."""
        used_region = region or self.region
        self._record_api_call(
            "/riot/account/v1/accounts/by-puuid/{puuid}",
            self._enum_str(used_region),
            {"puuid": puuid},
        )
        url = self.endpoints.account_by_puuid(puuid, region)
        response = await self._make_request(url)
        return AccountDTO(**response)

    # Summoner endpoints

    async def get_summoner_by_puuid(
        self, puuid: str, platform: Optional[Platform] = None
    ) -> SummonerDTO:
        """Get summoner by PUUID."""
        used_platform = platform or self.platform
        self._record_api_call(
            "/lol/summoner/v4/summoners/by-puuid/{puuid}",
            self._enum_str(used_platform),
            {"puuid": puuid},
        )
        url = self.endpoints.summoner_by_puuid(puuid, platform)
        response = await self._make_request(url)
        return SummonerDTO(**response)

    # Match endpoints
    async def get_match_list_by_puuid(
        self,
        puuid: str,
        start: int = 0,
        count: int = 20,
        queue: Optional[Union[int, str, QueueType]] = None,
        type: Optional[str | MatchType] = None,
        start_time: Optional[int] = None,
        end_time: Optional[int] = None,
        region: Optional[Region] = None,
    ) -> MatchListDTO:
        """Get match list by PUUID."""
        queue_type = self._normalize_queue_type(queue)
        match_type = self._normalize_match_type(type)
        self._validate_match_list_bounds(start, count, start_time, end_time)
        used_region = region or self.region

        self._record_api_call(
            "/lol/match/v5/matches/by-puuid/{puuid}/ids",
            self._enum_str(used_region),
            {"puuid": puuid},
        )

        url = self.endpoints.match_list_by_puuid(
            puuid,
            start,
            count,
            queue_type,
            match_type,
            start_time,
            end_time,
            region,
        )
        response_data = await self._make_request(url)

        # Extract match IDs from response
        if isinstance(response_data, list):
            match_ids = response_data
        else:
            match_ids = response_data.get("matchIds", [])

        return MatchListDTO(matchIds=match_ids, start=start, count=count, puuid=puuid)

    async def get_match(
        self, match_id: str, region: Optional[Region] = None
    ) -> MatchDTO:
        """Get match details by match ID."""
        used_region = region or self.region
        self._record_api_call(
            "/lol/match/v5/matches/{matchId}",
            self._enum_str(used_region),
            {"matchId": match_id},
        )
        url = self.endpoints.match_by_id(match_id, region)
        response = await self._make_request(url)
        return MatchDTO(**response)

    async def get_match_timeline(
        self, match_id: str, region: Optional[Region] = None
    ) -> dict:
        """Get match timeline by match ID."""
        used_region = region or self.region
        self._record_api_call(
            "/lol/match/v5/matches/{matchId}/timeline",
            self._enum_str(used_region),
            {"matchId": match_id},
        )
        url = self.endpoints.match_timeline_by_id(match_id, region)
        response = await self._make_request(url)
        if not isinstance(response, dict):
            raise RiotAPIError(
                f"Expected object response for match timeline, got {type(response)}"
            )
        return response

    # League endpoints
    async def get_league_entries_by_summoner_id(
        self, summoner_id: str, platform: Optional[Platform] = None
    ) -> List[LegacyLeagueEntryDTO]:
        """Get league entries by encrypted Summoner ID."""
        used_platform = platform or self.platform
        self._record_api_call(
            "/lol/league/v4/entries/by-summoner/{summonerId}",
            self._enum_str(used_platform),
            {"summonerId": summoner_id},
        )
        url = self.endpoints.league_entries_by_summoner_id(summoner_id, platform)
        response = await self._make_request(url)

        # API returns a list of league entries
        if not isinstance(response, list):
            raise RiotAPIError(
                f"Expected list response for league entries, got {type(response)}"
            )

        return [LegacyLeagueEntryDTO(**entry) for entry in response]

    async def get_league_entries_by_puuid(
        self, puuid: str, platform: Optional[Platform] = None
    ) -> List[LeagueEntryDTO]:
        """Get league entries by encrypted PUUID.

        This is the preferred method as it doesn't require getting Summoner ID first.
        Returns league entries for all ranked queues (Solo/Duo, Flex, etc.)
        """
        used_platform = platform or self.platform
        self._record_api_call(
            "/lol/league/v4/entries/by-puuid/{puuid}",
            self._enum_str(used_platform),
            {"puuid": puuid},
        )
        url = self.endpoints.league_entries_by_puuid(puuid, platform)
        response = await self._make_request(url)

        # API returns a list of league entries (can be empty if unranked)
        if not isinstance(response, list):
            raise RiotAPIError(
                f"Expected list response for league entries, got {type(response)}"
            )

        return [LeagueEntryDTO(**entry) for entry in response]

    # Utility methods

    @staticmethod
    def _normalize_queue_type(
        queue: Optional[Union[int, str, QueueType]],
    ) -> Optional[QueueType]:
        """Normalize a queue filter and reject unknown IDs."""
        if queue is None or isinstance(queue, QueueType):
            return queue

        try:
            queue_int = int(queue) if isinstance(queue, str) else queue
            return QueueType(queue_int)
        except (ValueError, TypeError) as error:
            raise ValueError(f"Unsupported Riot queue ID: {queue}") from error

    @staticmethod
    def _normalize_match_type(
        match_type: str | MatchType | None,
    ) -> MatchType | None:
        """Normalize a MATCH-V5 type filter and reject unknown values."""
        if match_type is None or isinstance(match_type, MatchType):
            return match_type

        try:
            return MatchType(match_type.lower())
        except (AttributeError, ValueError) as error:
            raise ValueError(f"Unsupported Riot match type: {match_type}") from error

    @staticmethod
    def _validate_match_list_bounds(
        start: int,
        count: int,
        start_time: int | None,
        end_time: int | None,
    ) -> None:
        """Validate MATCH-V5 pagination and epoch-second time filters."""
        if isinstance(start, bool) or not isinstance(start, int) or start < 0:
            raise ValueError("start must be a non-negative integer")
        if (
            isinstance(count, bool)
            or not isinstance(count, int)
            or not 0 <= count <= 100
        ):
            raise ValueError("count must be an integer between 0 and 100")

        for name, value in (("start_time", start_time), ("end_time", end_time)):
            if value is None:
                continue
            if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                raise ValueError(f"{name} must be a non-negative epoch-second integer")

        if start_time is not None and end_time is not None and start_time > end_time:
            raise ValueError("start_time must not be greater than end_time")
