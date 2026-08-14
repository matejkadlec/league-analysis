"""Small session helpers shared by writer paths."""

from sqlalchemy.ext.asyncio import AsyncSession


async def rollback_quietly(session: AsyncSession) -> None:
    """Roll back the current transaction, ignoring rollback failures."""
    try:
        await session.rollback()
    except Exception:
        pass
