"""Dependency injection for settings feature."""

from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db

from .service import SettingsService


async def get_settings_service(
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SettingsService:
    """Get settings service instance."""
    return SettingsService(db)


SettingsServiceDep = Annotated[SettingsService, Depends(get_settings_service)]
