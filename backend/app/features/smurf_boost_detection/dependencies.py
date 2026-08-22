"""Dependency wiring for smurf and boost detection."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.features.auth.dependencies import CurrentUserDep

from .service import SmurfBoostDetectionService


async def get_smurf_boost_service(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUserDep,
) -> SmurfBoostDetectionService:
    """Get smurf and boost detection service instance.

    The caller is resolved here rather than per endpoint. Every stored run
    belongs to one account, and a route that had to remember to pass the owner
    was a route that could forget -- which is how the newest-run lookup came to
    answer with whichever account had run last.
    """
    return SmurfBoostDetectionService(db, current_user.id)


SmurfBoostServiceDep = Annotated[
    SmurfBoostDetectionService, Depends(get_smurf_boost_service)
]

__all__ = ["SmurfBoostServiceDep", "get_smurf_boost_service"]
