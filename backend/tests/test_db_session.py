"""The shared rollback helper's one contract: never mask the original failure.

Every writer funnels error cleanup through `rollback_quietly`, so a rollback
that itself blows up must vanish rather than replace the original exception.
"""

from typing import cast
from unittest.mock import AsyncMock

from sqlalchemy.ext.asyncio import AsyncSession
from structlog.testing import capture_logs

from app.core.db_session import rollback_quietly


async def test_a_failing_rollback_is_swallowed_and_only_logged() -> None:
    """The swallow is the contract; the debug entry is its only trace."""
    session = AsyncMock()
    session.rollback.side_effect = RuntimeError("already closed")

    with capture_logs() as logs:
        await rollback_quietly(cast(AsyncSession, session))

    entries = [
        entry for entry in logs if entry.get("event") == "session_rollback_failed"
    ]
    assert len(entries) == 1
    assert entries[0]["error_type"] == "RuntimeError"
