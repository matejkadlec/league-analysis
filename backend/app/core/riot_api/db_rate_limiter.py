"""Database-backed rate limiter for coordinating Riot API calls across components.

This module provides a central rate limiting mechanism that persists state in the
database, allowing multiple components (Match Fetcher, Player Updater, Matchmaking Analysis)
to coordinate their API usage and avoid exceeding Riot's rate limits.

Rate Limits (Development Key):
- 20 requests per 1 second
- 100 requests per 2 minutes (120 seconds)

Priority System:
- Priority 1 (highest): PLAYER_UPDATER - Only 2 requests per run
- Priority 2 (medium): MATCH_FETCHER - Few requests per run per player
- Priority 3 (lowest): MATCHMAKING_ANALYSIS - Many requests (~1100 per analysis)

Higher priority components can "bump" lower priority ones, causing them to wait.
"""

import asyncio
from datetime import datetime, timezone, timedelta
from enum import Enum
from typing import Optional

import structlog
from sqlalchemy import String, Integer, Boolean, DateTime as SQLDateTime, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.models import Base

logger = structlog.get_logger(__name__)


class RateLimitComponent(str, Enum):
    """Components that make Riot API calls."""

    PLAYER_UPDATER = "PLAYER_UPDATER"
    MATCH_FETCHER = "MATCH_FETCHER"
    MATCHMAKING_ANALYSIS = "MATCHMAKING_ANALYSIS"


# Priority mapping - lower number = higher priority
COMPONENT_PRIORITY = {
    RateLimitComponent.PLAYER_UPDATER: 1,  # Highest - only 2 requests
    RateLimitComponent.MATCH_FETCHER: 2,  # Medium - few requests per player
    RateLimitComponent.MATCHMAKING_ANALYSIS: 3,  # Lowest - many requests
}


# Maximum wait times per component (seconds)
COMPONENT_MAX_WAIT = {
    RateLimitComponent.PLAYER_UPDATER: 30,  # 30 seconds max wait
    RateLimitComponent.MATCH_FETCHER: 120,  # 2 minutes max wait
    RateLimitComponent.MATCHMAKING_ANALYSIS: 1800,  # 30 minutes max wait (long analysis)
}


class RateLimitState(Base):
    """Database model for tracking rate limit state across components."""

    __tablename__ = "rate_limit_state"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    component: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        unique=True,
        comment="Component name: MATCH_FETCHER, PLAYER_UPDATER, MATCHMAKING_ANALYSIS",
    )
    priority: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=3,
        comment="Priority level: 1=highest, 2=medium, 3=lowest",
    )
    requests_made: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        comment="Number of requests made in current window",
    )
    window_start: Mapped[datetime] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        comment="Start time of current rate limit window",
    )
    window_size_seconds: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=120,
        comment="Size of rate limit window in seconds (Riot: 120s)",
    )
    max_requests: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=100,
        comment="Maximum requests per window (Riot dev: 100)",
    )
    is_waiting: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        comment="True if this component is waiting for higher priority components",
    )
    created_at: Mapped[datetime] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    __table_args__ = ({"schema": "core"},)

    def __repr__(self) -> str:
        return (
            f"<RateLimitState(component={self.component}, priority={self.priority}, "
            f"requests={self.requests_made}/{self.max_requests}, waiting={self.is_waiting})>"
        )


class DBRateLimiter:
    """Database-backed rate limiter for coordinating API calls across components.

    This class manages rate limits using the database as the source of truth,
    allowing multiple processes/components to coordinate their API usage.

    Usage:
        async with db_manager.get_session() as db:
            limiter = DBRateLimiter(db, RateLimitComponent.MATCH_FETCHER)

            # Before each API call
            can_proceed = await limiter.acquire()
            if not can_proceed:
                # Rate limited or bumped by higher priority
                return

            # Make API call
            await riot_client.get_match(...)

            # After API call
            await limiter.record_request()
    """

    # Class-level lock to prevent burst requests (20/second limit)
    _burst_lock = asyncio.Lock()
    _last_request_time: float = 0
    _min_request_spacing: float = 0.05  # 50ms = max 20 requests/second

    def __init__(
        self,
        db: AsyncSession,
        component: RateLimitComponent,
        window_size_seconds: int = 120,
        max_requests: int = 100,
    ):
        """Initialize the rate limiter.

        Args:
            db: Database session
            component: The component making API calls
            window_size_seconds: Rate limit window size (default: 120s for Riot)
            max_requests: Max requests per window (default: 100 for Riot dev key)
        """
        self.db = db
        self.component = component
        self.priority = COMPONENT_PRIORITY[component]
        self.max_wait = COMPONENT_MAX_WAIT[component]
        self.window_size_seconds = window_size_seconds
        self.max_requests = max_requests

    async def _get_or_create_state(self) -> RateLimitState:
        """Get or create rate limit state for this component."""
        result = await self.db.execute(
            select(RateLimitState).where(
                RateLimitState.component == self.component.value
            )
        )
        state = result.scalar_one_or_none()

        if not state:
            state = RateLimitState(
                component=self.component.value,
                priority=self.priority,
                requests_made=0,
                window_start=datetime.now(timezone.utc),
                window_size_seconds=self.window_size_seconds,
                max_requests=self.max_requests,
                is_waiting=False,
            )
            self.db.add(state)
            await self.db.commit()
            await self.db.refresh(state)
            logger.info(
                "Created rate limit state",
                component=self.component.value,
                priority=self.priority,
            )

        return state

    async def _get_total_requests_in_window(self) -> int:
        """Get total requests made by all components in the current window."""
        now = datetime.now(timezone.utc)
        window_start = now - timedelta(seconds=self.window_size_seconds)

        result = await self.db.execute(
            select(func.sum(RateLimitState.requests_made)).where(
                RateLimitState.window_start >= window_start
            )
        )
        total = result.scalar_one_or_none()
        return total or 0

    async def _reset_window_if_expired(self, state: RateLimitState) -> RateLimitState:
        """Reset the window if it has expired."""
        now = datetime.now(timezone.utc)
        window_end = state.window_start + timedelta(seconds=state.window_size_seconds)

        if now >= window_end:
            # Window expired, reset
            await self.db.execute(
                update(RateLimitState)
                .where(RateLimitState.component == self.component.value)
                .values(
                    requests_made=0,
                    window_start=now,
                    is_waiting=False,
                    updated_at=now,
                )
            )
            await self.db.commit()

            # Refresh state
            result = await self.db.execute(
                select(RateLimitState).where(
                    RateLimitState.component == self.component.value
                )
            )
            state = result.scalar_one()

            logger.debug(
                "Rate limit window reset",
                component=self.component.value,
            )

        return state

    async def _check_higher_priority_active(self) -> bool:
        """Check if a higher priority component is actively using the API."""
        now = datetime.now(timezone.utc)
        recent_threshold = now - timedelta(
            seconds=5
        )  # Consider "active" if used in last 5s

        result = await self.db.execute(
            select(RateLimitState).where(
                RateLimitState.priority < self.priority,
                RateLimitState.updated_at >= recent_threshold,
                RateLimitState.requests_made > 0,
            )
        )
        higher_priority = result.scalars().all()

        return len(higher_priority) > 0

    async def _wait_for_burst_limit(self) -> None:
        """Wait to respect the 20 requests/second limit."""
        async with DBRateLimiter._burst_lock:
            now = asyncio.get_event_loop().time()
            time_since_last = now - DBRateLimiter._last_request_time

            if time_since_last < DBRateLimiter._min_request_spacing:
                wait_time = DBRateLimiter._min_request_spacing - time_since_last
                await asyncio.sleep(wait_time)

            DBRateLimiter._last_request_time = asyncio.get_event_loop().time()

    async def acquire(self) -> bool:
        """Try to acquire permission to make an API request.

        This method will:
        1. Check if the rate limit window has expired and reset if needed
        2. Check if higher priority components are active (yield if so)
        3. Check if requests remain in the current window
        4. Wait if necessary (up to max_wait for this component)

        Returns:
            True if the request can proceed, False if rate limited/timed out
        """
        total_waited = 0

        while total_waited < self.max_wait:
            state = await self._get_or_create_state()
            state = await self._reset_window_if_expired(state)

            # Get total requests across all components
            total_requests = await self._get_total_requests_in_window()

            # Check if we have capacity
            if total_requests < self.max_requests:
                # Check if higher priority component is active
                if await self._check_higher_priority_active():
                    logger.debug(
                        "Yielding to higher priority component",
                        component=self.component.value,
                        priority=self.priority,
                    )
                    # Mark as waiting
                    await self.db.execute(
                        update(RateLimitState)
                        .where(RateLimitState.component == self.component.value)
                        .values(is_waiting=True, updated_at=datetime.now(timezone.utc))
                    )
                    await self.db.commit()

                    # Wait briefly and retry
                    await asyncio.sleep(1)
                    total_waited += 1
                    continue

                # Good to proceed - respect burst limit
                await self._wait_for_burst_limit()

                # Mark as not waiting
                if state.is_waiting:
                    await self.db.execute(
                        update(RateLimitState)
                        .where(RateLimitState.component == self.component.value)
                        .values(is_waiting=False, updated_at=datetime.now(timezone.utc))
                    )
                    await self.db.commit()

                return True

            # Calculate wait time until window resets
            now = datetime.now(timezone.utc)
            window_end = state.window_start + timedelta(
                seconds=state.window_size_seconds
            )
            wait_time = (window_end - now).total_seconds()

            if wait_time <= 0:
                # Window just expired, retry
                continue

            # Check if we would exceed max wait
            if total_waited + wait_time > self.max_wait:
                logger.warning(
                    "Rate limit wait would exceed max wait time",
                    component=self.component.value,
                    wait_time=wait_time,
                    max_wait=self.max_wait,
                    total_waited=total_waited,
                )
                return False

            logger.info(
                "Rate limit reached, waiting for window reset",
                component=self.component.value,
                total_requests=total_requests,
                max_requests=self.max_requests,
                wait_time=wait_time,
            )

            # Mark as waiting
            await self.db.execute(
                update(RateLimitState)
                .where(RateLimitState.component == self.component.value)
                .values(is_waiting=True, updated_at=datetime.now(timezone.utc))
            )
            await self.db.commit()

            await asyncio.sleep(min(wait_time, 10))  # Wait in chunks of 10s max
            total_waited += min(wait_time, 10)

        logger.warning(
            "Rate limit max wait exceeded",
            component=self.component.value,
            total_waited=total_waited,
            max_wait=self.max_wait,
        )
        return False

    async def record_request(self) -> None:
        """Record that a request was made.

        Call this after successfully making an API request.
        """
        now = datetime.now(timezone.utc)

        await self.db.execute(
            update(RateLimitState)
            .where(RateLimitState.component == self.component.value)
            .values(
                requests_made=RateLimitState.requests_made + 1,
                updated_at=now,
            )
        )
        await self.db.commit()

    async def release(self) -> None:
        """Release the rate limiter when done.

        Call this when the component finishes its work.
        """
        await self.db.execute(
            update(RateLimitState)
            .where(RateLimitState.component == self.component.value)
            .values(
                is_waiting=False,
                updated_at=datetime.now(timezone.utc),
            )
        )
        await self.db.commit()

    async def acquire_with_wait_callback(
        self,
        wait_callback: Optional[callable] = None,
    ) -> bool:
        """Try to acquire permission with callback for wait status updates.

        Args:
            wait_callback: Optional async callback called with (seconds_remaining,) when waiting
                           Called with 0 when wait is complete

        Returns:
            True if the request can proceed, False if rate limited/timed out
        """
        total_waited = 0

        while total_waited < self.max_wait:
            state = await self._get_or_create_state()
            state = await self._reset_window_if_expired(state)

            # Get total requests across all components
            total_requests = await self._get_total_requests_in_window()

            # Check if we have capacity
            if total_requests < self.max_requests:
                # Check if higher priority component is active
                if await self._check_higher_priority_active():
                    logger.debug(
                        "Yielding to higher priority component",
                        component=self.component.value,
                        priority=self.priority,
                    )
                    await asyncio.sleep(1)
                    total_waited += 1
                    continue

                # Good to proceed
                await self._wait_for_burst_limit()

                # Notify callback that wait is over
                if wait_callback:
                    try:
                        await wait_callback(0)
                    except Exception:
                        pass

                return True

            # Calculate wait time until window resets
            now = datetime.now(timezone.utc)
            window_end = state.window_start + timedelta(
                seconds=state.window_size_seconds
            )
            wait_time = (window_end - now).total_seconds()

            if wait_time <= 0:
                continue

            if total_waited + wait_time > self.max_wait:
                logger.warning(
                    "Rate limit wait would exceed max wait time",
                    component=self.component.value,
                    wait_time=wait_time,
                    max_wait=self.max_wait,
                )
                return False

            # Notify callback with remaining wait time (capped at 120 seconds)
            remaining_wait = min(int(wait_time), 120)
            if wait_callback:
                try:
                    await wait_callback(remaining_wait)
                except Exception:
                    pass

            logger.info(
                "Rate limit reached, waiting for window reset",
                component=self.component.value,
                wait_time=remaining_wait,
            )

            # Wait in small chunks and update callback
            chunk_size = 3  # Update every 3 seconds
            while remaining_wait > 0 and total_waited < self.max_wait:
                sleep_time = min(chunk_size, remaining_wait)
                await asyncio.sleep(sleep_time)
                total_waited += sleep_time
                remaining_wait -= sleep_time

                # Update callback with new remaining time
                if wait_callback and remaining_wait > 0:
                    try:
                        await wait_callback(remaining_wait)
                    except Exception:
                        pass

            # Notify callback that wait is complete
            if wait_callback:
                try:
                    await wait_callback(0)
                except Exception:
                    pass

        return False

    async def get_status(self) -> dict:
        """Get current rate limit status for this component."""
        state = await self._get_or_create_state()
        total_requests = await self._get_total_requests_in_window()

        return {
            "component": self.component.value,
            "priority": self.priority,
            "requests_made": state.requests_made,
            "total_requests_in_window": total_requests,
            "max_requests": self.max_requests,
            "remaining": max(0, self.max_requests - total_requests),
            "is_waiting": state.is_waiting,
            "window_start": state.window_start.isoformat(),
            "window_end": (
                state.window_start + timedelta(seconds=state.window_size_seconds)
            ).isoformat(),
        }


async def get_global_rate_limit_status(db: AsyncSession) -> dict:
    """Get global rate limit status across all components."""
    now = datetime.now(timezone.utc)
    window_start = now - timedelta(seconds=120)

    result = await db.execute(
        select(RateLimitState).where(RateLimitState.window_start >= window_start)
    )
    states = result.scalars().all()

    total_requests = sum(s.requests_made for s in states)

    return {
        "total_requests": total_requests,
        "max_requests": 100,
        "remaining": max(0, 100 - total_requests),
        "components": [
            {
                "component": s.component,
                "priority": s.priority,
                "requests_made": s.requests_made,
                "is_waiting": s.is_waiting,
            }
            for s in states
        ],
    }
