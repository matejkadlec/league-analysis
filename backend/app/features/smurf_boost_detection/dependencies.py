"""Dependency wiring for smurf and boost detection."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db

from .service import SmurfBoostDetectionService


async def get_smurf_boost_service(
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SmurfBoostDetectionService:
    """Get smurf and boost detection service instance."""
    return SmurfBoostDetectionService(db)


SmurfBoostServiceDep = Annotated[
    SmurfBoostDetectionService, Depends(get_smurf_boost_service)
]

__all__ = ["get_smurf_boost_service", "SmurfBoostServiceDep"]
