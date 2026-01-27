"""Dependencies for the player analysis feature."""

from typing import Annotated
from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_riot_client
from app.core.riot_api.client import RiotAPIClient
from app.features.matches.dependencies import get_match_service, MatchServiceDep

from .service import PlayerAnalysisService


async def get_detection_service(
    db: Annotated[AsyncSession, Depends(get_db)],
    riot_client: Annotated[RiotAPIClient, Depends(get_riot_client)],
    match_service: MatchServiceDep,
) -> PlayerAnalysisService:
    """Get player analysis service instance."""
    return PlayerAnalysisService(db, riot_client, match_service)


# Type alias for cleaner dependency injection
DetectionServiceDep = Annotated[PlayerAnalysisService, Depends(get_detection_service)]

__all__ = ["get_detection_service", "DetectionServiceDep"]
