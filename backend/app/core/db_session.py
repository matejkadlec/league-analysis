"""Small session helpers shared by writer paths."""

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)


async def rollback_quietly(session: AsyncSession) -> None:
    """Roll back the current transaction, ignoring rollback failures.

    The swallow is the contract: a rollback error must never mask the
    original failure that prompted the rollback, so it is only logged.
    """
    try:
        await session.rollback()
    except Exception as error:
        logger.debug(
            "session_rollback_failed",
            error_type=type(error).__name__,
        )
