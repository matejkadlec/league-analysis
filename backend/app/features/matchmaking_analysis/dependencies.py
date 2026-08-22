"""Dependencies for the matchmaking analysis feature."""

from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_riot_client
from app.core.riot_api.client import RiotAPIClient
from app.features.auth.dependencies import CurrentUserDep

from .service import MatchmakingAnalysisService


async def get_matchmaking_service(
    db: Annotated[AsyncSession, Depends(get_db)],
    riot_client: Annotated[RiotAPIClient, Depends(get_riot_client)],
    current_user: CurrentUserDep,
) -> MatchmakingAnalysisService:
    """Get matchmaking analysis service instance.

    No endpoint in this feature named the caller, so a run was identified by
    `(puuid, created_at)` alone -- and both of those are handed to the client
    by the status and history endpoints. Cancel and delete were reachable
    across accounts as a result. Resolving the owner here fixes every route at
    once and leaves none to be remembered.
    """
    return MatchmakingAnalysisService(db, riot_client, current_user.id)


# Type alias for cleaner dependency injection
MatchmakingServiceDep = Annotated[
    MatchmakingAnalysisService, Depends(get_matchmaking_service)
]

__all__ = ["MatchmakingServiceDep", "get_matchmaking_service"]
