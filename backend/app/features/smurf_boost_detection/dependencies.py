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

    The caller is resolved here rather than per endpoint: every stored run
    belongs to one account, and a route asked to pass the owner can forget.
    """
    return SmurfBoostDetectionService(db, current_user.id)


SmurfBoostServiceDep = Annotated[
    SmurfBoostDetectionService, Depends(get_smurf_boost_service)
]

__all__ = ["SmurfBoostServiceDep", "get_smurf_boost_service"]
