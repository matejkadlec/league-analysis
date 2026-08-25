"""Adaptive Riot rate limiting based on response headers."""

import asyncio
import time
from collections.abc import Mapping
from dataclasses import dataclass
from urllib.parse import urlsplit

import structlog

logger = structlog.get_logger(__name__)


def parse_rate_limit_header(header_value: str) -> list[dict[str, int]]:
    """
    Parse a rate limit or rate count header value; both share the grammar.

    Example: "20:1,100:120" -> [{"requests": 20, "window": 1}, {"requests": 100, "window": 120}]

    Args:
        header_value: Rate limit or rate count header value

    Returns:
        List of rate limit dictionaries
    """
    if not header_value:
        return []

    limits: list[dict[str, int]] = []
    for part in header_value.split(","):
        try:
            requests, window = map(int, part.strip().split(":"))
            limits.append({"requests": requests, "window": window})
        except ValueError, AttributeError:
            logger.warning(
                "Failed to parse rate limit part", part=part, header=header_value
            )
            continue

    return limits


@dataclass(frozen=True)
class _RateWindow:
    """One observed provider window anchored to its first local observation."""

    limit: int
    used: int
    window_seconds: int
    started_at: float

    @property
    def remaining(self) -> int:
        """Return provider capacity remaining in this window."""
        return self.limit - self.used

    @property
    def reset_at(self) -> float:
        """Return the monotonic reset deadline."""
        return self.started_at + self.window_seconds


class RateLimiter:
    """Track Riot application and method limits per routing scope.

    Riot windows begin with the first request in a window. Repeated responses
    therefore update the observed count without extending the reset deadline.
    Application windows are isolated by routing host, while method windows are
    isolated by routing host and normalized endpoint.

    Riot's requests-per-second application ceiling belongs to the API key, not
    to one client, and `RiotAPIClient` builds a limiter per client -- one per
    HTTP request in the request path. Burst spacing therefore lives on the
    class, so concurrent clients queue behind each other instead of each
    helping itself to a full 20 requests a second. The observed windows stay
    per-instance: those are learned from the responses one client actually saw.
    """

    _burst_lock = asyncio.Lock()
    _last_request_time = 0.0

    def __init__(self) -> None:
        """Initialize empty adaptive windows and conservative burst spacing."""
        self._app_windows: dict[tuple[str, int], _RateWindow] = {}
        self._method_windows: dict[tuple[str, int], _RateWindow] = {}
        self.request_spacing = 0.05
        self.lock = asyncio.Lock()

    @staticmethod
    def _get_routing_scope(endpoint: str) -> str:
        """Return the Riot routing host, or a stable local fallback for tests."""
        parsed = urlsplit(endpoint)
        return parsed.hostname or "unspecified"

    @staticmethod
    def _redact_count_for_segment(segment: str, next_segment: str | None) -> int:
        """Return how many following path segments are identifier values."""
        if segment == "by-riot-id":
            return 2
        if segment in {"by-puuid", "by-summoner"}:
            return 1
        if (
            segment == "matches"
            and next_segment is not None
            and next_segment != "by-puuid"
        ):
            return 1
        return 0

    @staticmethod
    def _normalize_endpoint_segments(segments: list[str]) -> list[str]:
        """Replace identifier path segments with a stable `{id}` token."""
        normalized_segments: list[str] = []
        redact_next = 0
        for index, segment in enumerate(segments):
            if redact_next:
                normalized_segments.append("{id}")
                redact_next -= 1
                continue

            normalized_segments.append(segment)
            next_segment = segments[index + 1] if index + 1 < len(segments) else None
            redact_next = RateLimiter._redact_count_for_segment(segment, next_segment)
        return normalized_segments

    def _get_endpoint_key(self, endpoint: str, method: str) -> str:
        """Return a method scope including routing host and service path."""
        parsed = urlsplit(endpoint)
        path = parsed.path or endpoint
        segments = [segment for segment in path.split("/") if segment]
        normalized_segments = self._normalize_endpoint_segments(segments)
        service_key = "/".join(normalized_segments) if normalized_segments else "root"
        return f"{method.upper()}:{self._get_routing_scope(endpoint)}:{service_key}"

    @staticmethod
    def _discard_expired(
        windows: dict[tuple[str, int], _RateWindow], now: float
    ) -> None:
        """Remove windows whose original provider interval has elapsed."""
        expired = [key for key, window in windows.items() if window.reset_at <= now]
        for key in expired:
            del windows[key]

    def _windows_for_scope(
        self, windows: dict[tuple[str, int], _RateWindow], scope: str
    ) -> list[_RateWindow]:
        """Return windows whose stored scope matches the current request."""
        return [
            window
            for (window_scope, _), window in windows.items()
            if window_scope == scope
        ]

    async def _sleep_if_windows_saturated(
        self,
        relevant_windows: list[_RateWindow],
        now: float,
        routing_scope: str,
        endpoint_key: str,
    ) -> float:
        """Sleep until the latest saturated window resets, then drop expired ones."""
        saturated = [window for window in relevant_windows if window.remaining <= 0]
        if not saturated:
            return now
        wait_time = max(window.reset_at - now for window in saturated)
        if wait_time <= 0:
            return now
        logger.info(
            "Riot rate limit reached, waiting",
            routing_scope=routing_scope,
            endpoint=endpoint_key,
            wait_time=wait_time,
        )
        await asyncio.sleep(wait_time)
        now = time.monotonic()
        self._discard_expired(self._app_windows, now)
        self._discard_expired(self._method_windows, now)
        return now

    async def wait_if_needed(self, endpoint: str, method: str = "GET") -> None:
        """Wait for saturated app/method windows and enforce burst spacing."""
        async with self.lock:
            now = time.monotonic()
            self._discard_expired(self._app_windows, now)
            self._discard_expired(self._method_windows, now)

            routing_scope = self._get_routing_scope(endpoint)
            endpoint_key = self._get_endpoint_key(endpoint, method)
            relevant_windows = self._windows_for_scope(self._app_windows, routing_scope)
            relevant_windows.extend(
                self._windows_for_scope(self._method_windows, endpoint_key)
            )
            now = await self._sleep_if_windows_saturated(
                relevant_windows, now, routing_scope, endpoint_key
            )

            async with RateLimiter._burst_lock:
                time_since_last = now - RateLimiter._last_request_time
                if time_since_last < self.request_spacing:
                    await asyncio.sleep(self.request_spacing - time_since_last)

                RateLimiter._last_request_time = time.monotonic()

    @staticmethod
    def _parse_rate_headers(
        limit_header: str, count_header: str
    ) -> tuple[list[dict[str, int]], list[dict[str, int]]] | None:
        """Parse a limit/count header pair."""
        if not limit_header or not count_header:
            return None

        limits = parse_rate_limit_header(limit_header)
        counts = parse_rate_limit_header(count_header)
        if not limits or not counts:
            return None
        return limits, counts

    @staticmethod
    def _record_window(
        windows: dict[tuple[str, int], _RateWindow],
        scope: str,
        limit: int,
        used: int,
        window_seconds: int,
        observed_at: float,
    ) -> None:
        """Update a window count without moving an active window's start."""
        key = (scope, window_seconds)
        current = windows.get(key)
        starts_new_window = (
            current is None
            or current.limit != limit
            or current.reset_at <= observed_at
            or used < current.used
        )
        if starts_new_window:
            started_at = observed_at
        else:
            assert current is not None
            started_at = current.started_at
        windows[key] = _RateWindow(
            limit=limit,
            used=used,
            window_seconds=window_seconds,
            started_at=started_at,
        )

    def _process_rate_limit_pair(
        self,
        limit_header: str,
        count_header: str,
        windows: dict[tuple[str, int], _RateWindow],
        scope: str,
        observed_at: float,
    ) -> None:
        """Apply matching provider windows from one header pair."""
        parsed = self._parse_rate_headers(limit_header, count_header)
        if not parsed:
            return

        limits, counts = parsed
        counts_by_window = {item["window"]: item["requests"] for item in counts}
        for limit in limits:
            window_seconds = limit["window"]
            used = counts_by_window.get(window_seconds)
            if used is None:
                continue
            self._record_window(
                windows,
                scope,
                limit["requests"],
                used,
                window_seconds,
                observed_at,
            )

    def update_limits(
        self, headers: Mapping[str, str], endpoint: str, method: str = "GET"
    ) -> None:
        """Update routing-scoped application and method windows from a response.

        `httpx.Headers` is already case-insensitive and already stores the
        lower-cased key, so nothing lowercases these on the way in. The
        `except` below is what covers a caller that hands over something else.
        """
        try:
            observed_at = time.monotonic()
            self._process_rate_limit_pair(
                headers.get("x-app-rate-limit", ""),
                headers.get("x-app-rate-limit-count", ""),
                self._app_windows,
                self._get_routing_scope(endpoint),
                observed_at,
            )
            self._process_rate_limit_pair(
                headers.get("x-method-rate-limit", ""),
                headers.get("x-method-rate-limit-count", ""),
                self._method_windows,
                self._get_endpoint_key(endpoint, method),
                observed_at,
            )
        except Exception as error:
            logger.warning(
                "Failed to parse Riot rate limit headers",
                error_type=type(error).__name__,
            )
