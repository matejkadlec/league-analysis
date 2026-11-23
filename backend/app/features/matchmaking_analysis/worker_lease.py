"""One live worker per matchmaking analysis run, across processes.

The run registry in `service.py` is process-local, so it missed a worker that
outlived a restart (LGA-129). An advisory lock is seen by every process and
dies with its connection, so a dead worker leaves none behind.
"""

import hashlib
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from datetime import UTC, datetime

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

# The first key of every lease, so these locks cannot meet an advisory lock
# another feature takes. ASCII "MMAW".
LEASE_NAMESPACE = 0x4D4D4157

# `pg_locks` reports the two keys of `pg_try_advisory_lock(int, int)` as
# `classid` and `objid` with `objsubid = 2`, and per database.
_LEASE_HELD_SQL = text(
    "SELECT EXISTS (SELECT 1 FROM pg_locks"
    " WHERE locktype = 'advisory' AND granted AND objsubid = 2"
    " AND classid = :namespace AND objid = :key"
    " AND database = (SELECT oid FROM pg_database"
    " WHERE datname = current_database()))"
)


def run_lease_key(user_id: int, puuid: str, created_at: datetime) -> int:
    """The second lease key: a stable, non-negative digest of the run identity."""
    identity = f"{user_id}:{puuid}:{created_at.astimezone(UTC).isoformat()}"
    digest = hashlib.blake2b(identity.encode(), digest_size=4).digest()
    return int.from_bytes(digest, "big") & 0x7FFFFFFF


@asynccontextmanager
async def hold_run_lease(
    engine: AsyncEngine, user_id: int, puuid: str, created_at: datetime
) -> AsyncGenerator[bool]:
    """Hold the run's lease on a connection of its own while the worker lives.

    Yields whether the lease was free. The connection is closed on the way out,
    never pooled: closing it releases the lock even when no unlock could run.
    """
    key = run_lease_key(user_id, puuid, created_at)
    async with engine.connect() as connection:
        try:
            acquired = await connection.scalar(
                select(func.pg_try_advisory_lock(LEASE_NAMESPACE, key))
            )
            # The lock is session-level, so ending the transaction keeps it and
            # leaves the connection idle rather than idle in a transaction.
            await connection.commit()
            yield bool(acquired)
        finally:
            await connection.invalidate()


async def run_lease_is_held(
    session: AsyncSession, user_id: int, puuid: str, created_at: datetime
) -> bool:
    """Whether a worker in any process holds the run's lease right now."""
    held = await session.scalar(
        _LEASE_HELD_SQL,
        {
            "namespace": LEASE_NAMESPACE,
            "key": run_lease_key(user_id, puuid, created_at),
        },
    )
    return bool(held)
