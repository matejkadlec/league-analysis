"""Dependencies for the playstyle analysis feature."""

from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db

from .service import PlaystyleAnalysisService


async def get_playstyle_analysis_service(
    db: Annotated[AsyncSession, Depends(get_db)],
) -> PlaystyleAnalysisService:
    """Get playstyle analysis service instance."""
    return PlaystyleAnalysisService(db)


# Type alias for cleaner dependency injection
PlaystyleAnalysisServiceDep = Annotated[
    PlaystyleAnalysisService, Depends(get_playstyle_analysis_service)
]

__all__ = ["get_playstyle_analysis_service", "PlaystyleAnalysisServiceDep"]
