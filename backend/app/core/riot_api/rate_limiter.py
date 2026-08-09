"""Adaptive Riot rate limiting based on response headers."""

import asyncio
import time
from dataclasses import dataclass
from typing import Dict
from urllib.parse import urlsplit

import structlog

from .endpoints import parse_rate_count_header, parse_rate_limit_header

logger = structlog.get_logger(__name__)


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
    """

    def __init__(self) -> None:
        """Initialize empty adaptive windows and conservative burst spacing."""
        self._app_windows: dict[tuple[str, int], _RateWindow] = {}
        self._method_windows: dict[tuple[str, int], _RateWindow] = {}
        self.last_request_time = 0.0
        self.request_spacing = 0.05
        self.lock = asyncio.Lock()

    @staticmethod
    def _get_routing_scope(endpoint: str) -> str:
        """Return the Riot routing host, or a stable local fallback for tests."""
        parsed = urlsplit(endpoint)
        return parsed.hostname or "unspecified"

    def _get_endpoint_key(self, endpoint: str, method: str) -> str:
        """Return a method scope including routing host and service path."""
        parsed = urlsplit(endpoint)
        path = parsed.path or endpoint
        segments = [segment for segment in path.split("/") if segment]
        normalized_segments: list[str] = []
        redact_next = 0
        for index, segment in enumerate(segments):
            if redact_next:
                normalized_segments.append("{id}")
                redact_next -= 1
                continue

            normalized_segments.append(segment)
            if segment == "by-riot-id":
                redact_next = 2
            elif segment in {"by-puuid", "by-summoner"}:
                redact_next = 1
            elif (
                segment == "matches"
                and index + 1 < len(segments)
                and segments[index + 1] != "by-puuid"
            ):
                redact_next = 1

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

    async def wait_if_needed(self, endpoint: str, method: str = "GET") -> None:
        """Wait for saturated app/method windows and enforce burst spacing."""
        async with self.lock:
            now = time.monotonic()
            self._discard_expired(self._app_windows, now)
            self._discard_expired(self._method_windows, now)

            routing_scope = self._get_routing_scope(endpoint)
            endpoint_key = self._get_endpoint_key(endpoint, method)
            relevant_windows = [
                window
                for (scope, _), window in self._app_windows.items()
                if scope == routing_scope
            ]
            relevant_windows.extend(
                window
                for (scope, _), window in self._method_windows.items()
                if scope == endpoint_key
            )

            saturated = [window for window in relevant_windows if window.remaining <= 0]
            if saturated:
                wait_time = max(window.reset_at - now for window in saturated)
                if wait_time > 0:
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

            time_since_last = now - self.last_request_time
            if time_since_last < self.request_spacing:
                await asyncio.sleep(self.request_spacing - time_since_last)

            self.last_request_time = time.monotonic()

    @staticmethod
    def _parse_rate_headers(
        limit_header: str, count_header: str
    ) -> tuple[list[Dict[str, int]], list[Dict[str, int]]] | None:
        """Parse a limit/count header pair."""
        if not limit_header or not count_header:
            return None

        limits = parse_rate_limit_header(limit_header)
        counts = parse_rate_count_header(count_header)
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
        self, headers: Dict[str, str], endpoint: str, method: str = "GET"
    ) -> None:
        """Update routing-scoped application and method windows from a response."""
        try:
            normalized_headers = {key.lower(): value for key, value in headers.items()}
            observed_at = time.monotonic()
            self._process_rate_limit_pair(
                normalized_headers.get("x-app-rate-limit", ""),
                normalized_headers.get("x-app-rate-limit-count", ""),
                self._app_windows,
                self._get_routing_scope(endpoint),
                observed_at,
            )
            self._process_rate_limit_pair(
                normalized_headers.get("x-method-rate-limit", ""),
                normalized_headers.get("x-method-rate-limit-count", ""),
                self._method_windows,
                self._get_endpoint_key(endpoint, method),
                observed_at,
            )
        except Exception as error:
            logger.warning(
                "Failed to parse Riot rate limit headers",
                error_type=type(error).__name__,
            )
