"""Riot API HTTP client with proper rate limiting, error handling, and authentication."""

import asyncio
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Protocol

import httpx
import structlog
from tenacity import (
    AsyncRetrying,
    RetryCallState,
    retry_if_exception,
    stop_after_attempt,
)

from .constants import MatchType, Platform, QueueType, Region, enum_str
from .credential_vocabulary import RiotCredentialStatus
from .endpoints import (
    ACCOUNT_BY_PUUID,
    ACCOUNT_BY_RIOT_ID,
    LEAGUE_ENTRIES_BY_PUUID,
    MATCH_BY_ID,
    MATCH_LIST_BY_PUUID,
    MATCH_TIMELINE_BY_ID,
    SUMMONER_BY_PUUID,
    RiotAPIEndpoints,
)
from .errors import (
    AuthenticationError,
    BadRequestError,
    ForbiddenError,
    NotFoundError,
    NullResponseBodyError,
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
    MatchTimelineDTO,
    SummonerDTO,
)
from .rate_limiter import RateLimiter

logger = structlog.get_logger(__name__)

# Any value a Riot JSON response can hold. Declaring a local as `JSONValue`
# before an `isinstance` chain keeps each narrowing step a *known* type, which
# `Any` does not (narrowing `Any` yields `dict[Unknown, Unknown]`).
type JSONValue = (
    dict[str, JSONValue] | list[JSONValue] | str | int | float | bool | None
)


class JSONBody(Protocol):
    """Anything that can decode itself as JSON, or raise trying.

    `_extract_riot_status_message` needs nothing from a response but `.json()`,
    and it is exercised with hand-rolled stubs as well as `httpx.Response`.
    """

    def json(self) -> JSONValue: ...


@dataclass
class APICallRecord:
    """Record of an individual API call."""

    endpoint: str  # Template like "/lol/match/v5/matches/{matchId}"
    region: str
    params: dict[str, str] = field(
        default_factory=dict[str, str]
    )  # e.g., {"matchId": "EUN1_123"}
    timestamp: str = ""  # ISO timestamp


class RiotAPIClient:
    """Comprehensive Riot API client with rate limiting and error handling."""

    def __init__(
        self,
        api_key: str | None = None,
        region: Region | None = None,
        platform: Platform | None = None,
        request_callback: Callable[[str, int], None] | None = None,
        credential_health_callback: Callable[
            [RiotCredentialStatus, datetime], Awaitable[None]
        ]
        | None = None,
    ):
        """
        Initialize Riot API client.

        Args:
            api_key: Riot API key (uses config if None)
            region: Default region for regional endpoints
            platform: Default platform for platform endpoints
            request_callback: Optional callback for tracking API requests (metric_name, count)
            credential_health_callback: Durable observer for authenticated provider responses
        """
        if not api_key:
            raise ValueError(
                "api_key is required - build the client with create_tracked_riot_api_client()"
            )

        self.api_key = api_key
        # Default to EUN region if not specified
        self.region = region or Region("europe")
        self.platform = platform or Platform("eun1")
        self.request_callback = request_callback
        self.credential_health_callback = credential_health_callback

        # Initialize components
        self.rate_limiter = RateLimiter()
        self.endpoints = RiotAPIEndpoints(self.region, self.platform)

        # HTTP session
        self.session = None
        self._session_lock = asyncio.Lock()

        # Track individual API calls for job logging
        self._api_calls: list[APICallRecord] = []

    async def __aenter__(self):
        """Async context manager entry."""
        await self.start_session()
        return self

    async def __aexit__(
        self,
        _exc_type: type[BaseException] | None,
        _exc_val: BaseException | None,
        _exc_tb: object | None,
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
                        region=enum_str(self.region),
                        platform=enum_str(self.platform),
                        api_key_prefix="[REDACTED]" if self.api_key else "None",
                    )

    async def close(self) -> None:
        """Close the httpx session."""
        if self.session and not self.session.is_closed:
            await self.session.aclose()
            logger.info("Riot API client session closed")

    def get_api_calls(self) -> list[APICallRecord]:
        """Get all recorded API calls for this session."""
        return self._api_calls.copy()

    def _record_api_call(
        self, endpoint_template: str, region: str, params: dict[str, str]
    ) -> None:
        """Record an API call for job logging."""
        self._api_calls.append(
            APICallRecord(
                endpoint=endpoint_template,
                region=region.upper() if region else "UNKNOWN",
                params=params,
                timestamp=datetime.now(UTC).isoformat(),
            )
        )

    @staticmethod
    def _extract_riot_status_message(response: JSONBody) -> str | None:
        """Return Riot's `status.message` for an error response, if present."""
        payload: JSONValue
        try:
            payload = response.json()
        except Exception as error:
            logger.debug(
                "riot_status_message_parse_failed",
                error_type=type(error).__name__,
            )
            return None

        if not isinstance(payload, dict):
            return None
        status_block = payload.get("status")
        if not isinstance(status_block, dict):
            return None
        message = status_block.get("message")
        return message if isinstance(message, str) else None

    def _raise_client_error_if_needed(
        self, status: int, riot_message: str | None = None
    ) -> None:
        """Raise specific RiotAPIError subclass for client errors."""
        if status == 400:
            if riot_message and "exception decrypting" in riot_message.lower():
                logger.error(
                    "riot_puuid_decryption_failed",
                    error_type="PuuidDecryptionError",
                    status_code=status,
                )
                raise PuuidDecryptionError(
                    "Stored PUUID was issued to a different developer account",
                    status_code=status,
                )
            raise BadRequestError("Invalid request parameters", status_code=status)
        elif status == 401:
            raise AuthenticationError("Invalid API key", status_code=status)
        elif status == 403:
            raise ForbiddenError("Access forbidden", status_code=status)
        elif status == 404:
            raise NotFoundError("Resource not found", status_code=status)

    @staticmethod
    def _parse_retry_after(
        headers: Mapping[str, str], default_seconds: int = 120
    ) -> int:
        """Parse Retry-After header with a safe fallback."""
        raw_retry_after = headers.get("retry-after")
        if raw_retry_after is None:
            return default_seconds

        try:
            retry_after = int(float(raw_retry_after))
        except TypeError, ValueError:
            logger.debug(
                "riot_retry_after_parse_failed",
                raw_retry_after=raw_retry_after,
            )
            return default_seconds

        return max(retry_after, 1)

    def _handle_rate_limit(self, headers: Mapping[str, str]) -> None:
        """Log the header evidence, then raise the 429 as a retryable error."""
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

        raise RateLimitError(
            "Rate limit exceeded",
            status_code=429,
            retry_after=retry_after,
        )

    @staticmethod
    def _handle_server_error(status: int) -> None:
        """Raise the 5xx as a retryable error; the retry policy owns the rest."""
        if status == 503:
            raise ServiceUnavailableError("Service unavailable", status_code=status)
        raise RiotAPIError(f"Server error {status}", status_code=status)

    def _handle_http_error_status(
        self,
        status: int,
        headers: Mapping[str, str],
        riot_message: str | None = None,
    ) -> None:
        """Raise the mapped error for a known status; return for anything else.

        429 and 5xx raises are retryable (see `_is_transient_error`); the
        client errors raised by `_raise_client_error_if_needed` are not.
        """
        self._raise_client_error_if_needed(status, riot_message)

        if status == 429:
            self._handle_rate_limit(headers)

        if status >= 500:
            self._handle_server_error(status)

    async def _execute_single_request(
        self,
        url: str,
        method: str,
    ) -> dict[str, Any] | list[Any]:
        """Execute a single HTTP request, raising mapped errors for bad statuses.

        On success the return is Riot's decoded body, which is always a JSON
        object or array. An unmapped non-200 status keeps its long-standing
        behaviour of returning the decoded body rather than raising.
        """
        if self.session is None:
            raise RiotAPIError("Session not initialized")

        evidence_at = datetime.now(UTC)
        response = await self.session.request(method, url)

        # Track all API requests (successful or failed) - every HTTP call counts
        if self.request_callback:
            self.request_callback("requests_made", 1)

        try:
            await self._record_credential_health(response.status_code, evidence_at)
            self.rate_limiter.update_limits(response.headers, url, method)

            if response.status_code != 200:
                self._handle_http_error_status(
                    response.status_code,
                    response.headers,
                    self._extract_riot_status_message(response),
                )

            response_data = response.json()
            if response_data is None:
                # Letting None through returns it to callers typed
                # `dict | list`, which then crash on a subscript far from the
                # HTTP layer.
                raise NullResponseBodyError("Request failed: response body was null")
            return response_data
        finally:
            await response.aclose()

    async def _record_credential_health(
        self, status_code: int, evidence_at: datetime
    ) -> None:
        """Record only responses that prove credential acceptance or rejection."""
        if self.credential_health_callback is None:
            return
        if 200 <= status_code < 300 or status_code == 404:
            status = RiotCredentialStatus.VALID
        elif status_code in {401, 403}:
            status = RiotCredentialStatus.INVALID
        else:
            return
        await self.credential_health_callback(status, evidence_at)

    @staticmethod
    def _is_transient_error(error: BaseException) -> bool:
        """The retry policy: network failures, null bodies, 429s and 5xx."""
        if isinstance(error, TimeoutError | httpx.RequestError):
            return True
        if isinstance(error, NullResponseBodyError):
            return True
        return isinstance(error, RiotAPIError) and (
            error.status_code == 429 or (error.status_code or 0) >= 500
        )

    @staticmethod
    def _transient_wait(retry_state: RetryCallState) -> float:
        """A 429 waits what Riot said; everything else backs off 1s, 2s, 4s."""
        error = retry_state.outcome.exception() if retry_state.outcome else None
        if isinstance(error, RateLimitError) and error.retry_after:
            return float(error.retry_after)
        return float(2 ** (retry_state.attempt_number - 1))

    def _log_transient_retry(self, retry_state: RetryCallState, url: str) -> None:
        """Keep every retry decision visible before its sleep, as before."""
        error = retry_state.outcome.exception() if retry_state.outcome else None
        attempt = retry_state.attempt_number - 1
        if isinstance(error, RateLimitError):
            return  # "Rate limit hit" was already logged when the 429 landed.
        if isinstance(error, NullResponseBodyError):
            return  # Retried silently, as the old loop did; exhaustion logs.
        if isinstance(error, TimeoutError | httpx.RequestError):
            logger.warning(
                "riot_api_network_retry",
                endpoint=self._extract_endpoint_path(url),
                attempt=attempt,
                error_type=type(error).__name__,
                error=str(error),
            )
        elif isinstance(error, RiotAPIError):
            # The logged wait is read off the retryer itself (set before
            # before_sleep fires), so the backoff policy lives in exactly one
            # place — _transient_wait — and this line cannot drift from it.
            next_action = retry_state.next_action
            logger.warning(
                "riot_api_retrying_server_error",
                status_code=error.status_code,
                attempt=attempt,
                retry_after=next_action.sleep if next_action else None,
            )

    async def _make_request(
        self,
        url: str,
        method: str = "GET",
        retry_on_failure: bool = True,
    ) -> dict[str, Any] | list[Any]:
        """
        Make HTTP request with rate limiting and retry logic.

        Args:
            url: Request URL
            method: HTTP method
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

        max_attempts = 4 if retry_on_failure else 1
        retryer = AsyncRetrying(
            retry=retry_if_exception(self._is_transient_error),
            stop=stop_after_attempt(max_attempts),
            wait=self._transient_wait,
            before_sleep=lambda retry_state: self._log_transient_retry(
                retry_state, url
            ),
            # The retryer is built per call, so this attribute lookup already
            # happens after any test has patched `asyncio.sleep`.
            sleep=asyncio.sleep,
            reraise=True,
        )
        try:
            return await retryer(self._execute_single_request, url, method)
        except (TimeoutError, httpx.RequestError) as error:
            logger.error(
                "riot_api_request_failed",
                endpoint=self._extract_endpoint_path(url),
                attempts=max_attempts,
                error_type=type(error).__name__,
                error=str(error),
            )
            raise RiotAPIError(f"Request failed: {error!s}") from error
        except RiotAPIError as error:
            # Exhausted 5xx and null bodies keep their terminal log; a 429
            # raises bare, and the immediately-raised client errors were
            # never logged here.
            if (error.status_code or 0) >= 500 or isinstance(
                error, NullResponseBodyError
            ):
                logger.error(
                    "riot_api_request_failed",
                    endpoint=self._extract_endpoint_path(url),
                    status_code=error.status_code,
                    attempts=max_attempts,
                    error_type=type(error).__name__,
                )
            raise

    async def probe_credentials(self, url: str) -> object:
        """Send one un-retried GET purely to observe whether Riot accepts the key.

        Credential validation cares only about the status Riot answers with, so
        retrying would turn an expired key into three pointless calls against a
        limit the rest of the app is sharing.
        """
        return await self._make_request(url, method="GET", retry_on_failure=False)

    def _extract_endpoint_path(self, url: str) -> str:
        """Extract endpoint path from URL for rate limiting."""
        stripped = url.replace("https://", "").replace("http://", "")
        parts = stripped.split("/", 1)
        if len(parts) == 2:
            return parts[1]
        return stripped

    @staticmethod
    def _require_object(
        response: dict[str, Any] | list[Any], what: str
    ) -> dict[str, Any]:
        """Assert that a single-entity endpoint answered with a JSON object.

        Riot returns an array only for list endpoints, so an array here is a
        broken contract rather than data: fail with the client's own error
        type instead of letting `Model(**response)` raise a bare `TypeError`.
        """
        if not isinstance(response, dict):
            raise RiotAPIError(
                f"Expected object response for {what}, got {type(response)}"
            )
        return response

    # Account endpoints
    async def get_account_by_riot_id(
        self, game_name: str, tag_line: str, region: Region | None = None
    ) -> AccountDTO:
        """Get account by Riot ID (gameName#tagLine)."""
        used_region = region or self.region
        self._record_api_call(
            ACCOUNT_BY_RIOT_ID,
            enum_str(used_region),
            {"gameName": game_name, "tagLine": tag_line},
        )
        url = self.endpoints.account_by_riot_id(game_name, tag_line, region)
        response = await self._make_request(url)
        return AccountDTO(**self._require_object(response, "account"))

    async def get_account_by_puuid(
        self, puuid: str, region: Region | None = None
    ) -> AccountDTO:
        """Get account by PUUID."""
        used_region = region or self.region
        self._record_api_call(
            ACCOUNT_BY_PUUID,
            enum_str(used_region),
            {"puuid": puuid},
        )
        url = self.endpoints.account_by_puuid(puuid, region)
        response = await self._make_request(url)
        return AccountDTO(**self._require_object(response, "account"))

    # Summoner endpoints

    async def get_summoner_by_puuid(
        self, puuid: str, platform: Platform | None = None
    ) -> SummonerDTO:
        """Get summoner by PUUID."""
        used_platform = platform or self.platform
        self._record_api_call(
            SUMMONER_BY_PUUID,
            enum_str(used_platform),
            {"puuid": puuid},
        )
        url = self.endpoints.summoner_by_puuid(puuid, platform)
        response = await self._make_request(url)
        return SummonerDTO(**self._require_object(response, "summoner"))

    # Match endpoints
    async def get_match_list_by_puuid(
        self,
        puuid: str,
        start: int = 0,
        count: int = 20,
        queue: int | str | QueueType | None = None,
        type: str | MatchType | None = None,
        start_time: int | None = None,
        end_time: int | None = None,
        region: Region | None = None,
    ) -> MatchListDTO:
        """Get match list by PUUID."""
        queue_type = self._normalize_queue_type(queue)
        match_type = self._normalize_match_type(type)
        self._validate_match_list_bounds(start, count, start_time, end_time)
        used_region = region or self.region

        self._record_api_call(
            MATCH_LIST_BY_PUUID,
            enum_str(used_region),
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
        response_data: dict[str, Any] | list[str] = await self._make_request(url)

        # Extract match IDs from response
        match_ids: list[str]
        if isinstance(response_data, list):
            match_ids = response_data
        else:
            match_ids = response_data.get("matchIds", [])

        return MatchListDTO(match_ids=match_ids, start=start, count=count, puuid=puuid)

    async def get_match(self, match_id: str, region: Region | None = None) -> MatchDTO:
        """Get match details by match ID."""
        used_region = region or self.region
        self._record_api_call(
            MATCH_BY_ID,
            enum_str(used_region),
            {"matchId": match_id},
        )
        url = self.endpoints.match_by_id(match_id, region)
        response = await self._make_request(url)
        return MatchDTO(**self._require_object(response, "match"))

    async def get_match_timeline(
        self, match_id: str, region: Region | None = None
    ) -> MatchTimelineDTO:
        """Get match timeline by match ID."""
        used_region = region or self.region
        self._record_api_call(
            MATCH_TIMELINE_BY_ID,
            enum_str(used_region),
            {"matchId": match_id},
        )
        url = self.endpoints.match_timeline_by_id(match_id, region)
        response = await self._make_request(url)
        return MatchTimelineDTO.model_validate(
            self._require_object(response, "match timeline")
        )

    # League endpoints
    async def get_league_entries_by_puuid(
        self, puuid: str, platform: Platform | None = None
    ) -> list[LeagueEntryDTO]:
        """Get league entries by encrypted PUUID.

        This is the preferred method as it doesn't require getting Summoner ID first.
        Returns league entries for all ranked queues (Solo/Duo, Flex, etc.)
        """
        used_platform = platform or self.platform
        self._record_api_call(
            LEAGUE_ENTRIES_BY_PUUID,
            enum_str(used_platform),
            {"puuid": puuid},
        )
        url = self.endpoints.league_entries_by_puuid(puuid, platform)
        response: dict[str, Any] | list[dict[str, Any]] = await self._make_request(url)

        # API returns a list of league entries (can be empty if unranked)
        if not isinstance(response, list):
            raise RiotAPIError(
                f"Expected list response for league entries, got {type(response)}"
            )

        return [LeagueEntryDTO(**entry) for entry in response]

    # Utility methods

    @staticmethod
    def _normalize_queue_type(
        queue: int | str | QueueType | None,
    ) -> QueueType | None:
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
    def _is_non_negative_int(value: object) -> bool:
        """Return True for a real int >= 0. Rejects bool, which subclasses int."""
        return not isinstance(value, bool) and isinstance(value, int) and value >= 0

    @staticmethod
    def _is_match_list_count(value: object) -> bool:
        """Return True for a real int in the MATCH-V5 count range."""
        return (
            not isinstance(value, bool) and isinstance(value, int) and 0 <= value <= 100
        )

    @staticmethod
    def _require_optional_epoch_seconds(name: str, value: int | None) -> None:
        """Reject a present time filter that is not a non-negative epoch second."""
        if value is None:
            return
        if not RiotAPIClient._is_non_negative_int(value):
            raise ValueError(f"{name} must be a non-negative epoch-second integer")

    @staticmethod
    def _validate_match_list_bounds(
        start: int,
        count: int,
        start_time: int | None,
        end_time: int | None,
    ) -> None:
        """Validate MATCH-V5 pagination and epoch-second time filters."""
        if not RiotAPIClient._is_non_negative_int(start):
            raise ValueError("start must be a non-negative integer")
        if not RiotAPIClient._is_match_list_count(count):
            raise ValueError("count must be an integer between 0 and 100")

        RiotAPIClient._require_optional_epoch_seconds("start_time", start_time)
        RiotAPIClient._require_optional_epoch_seconds("end_time", end_time)
        if start_time is not None and end_time is not None and start_time > end_time:
            raise ValueError("start_time must not be greater than end_time")
