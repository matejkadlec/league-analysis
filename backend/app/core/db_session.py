"""Small session helpers shared by writer paths."""

import contextlib

from sqlalchemy.ext.asyncio import AsyncSession


async def rollback_quietly(session: AsyncSession) -> None:
    """Roll back the current transaction, ignoring rollback failures."""
    with contextlib.suppress(Exception):
        await session.rollback()
