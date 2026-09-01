"""Dependencies for the matchmaking analysis feature."""

from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.features.auth.dependencies import CurrentUserDep

from .service import MatchmakingAnalysisService


async def get_matchmaking_service(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUserDep,
) -> MatchmakingAnalysisService:
    """Get matchmaking analysis service instance.

    Deliberately built without a Riot client: `get_riot_client` refuses the whole
    request when no key is active, which would take the DB reads down with it.
    """
    return MatchmakingAnalysisService(db, None, current_user.id)


# Type alias for cleaner dependency injection
MatchmakingServiceDep = Annotated[
    MatchmakingAnalysisService, Depends(get_matchmaking_service)
]

__all__ = ["MatchmakingServiceDep", "get_matchmaking_service"]
