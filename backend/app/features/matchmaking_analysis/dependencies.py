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

    No endpoint in this feature named the caller, so a run was identified by
    `(puuid, created_at)` alone -- and both of those are handed to the client
    by the status and history endpoints. Cancel and delete were reachable
    across accounts as a result. Resolving the owner here fixes every route at
    once and leaves none to be remembered.

    Deliberately built without a Riot client. Every Riot call in this feature
    happens on the background instance, which opens its own tracked client --
    while `get_riot_client` refuses the whole request when no key is active.
    Injected here, that refusal took down the pure DB reads too, so a lapsed
    key made even *stored* analyses unreadable (2026-08-25 prod outage).
    """
    return MatchmakingAnalysisService(db, None, current_user.id)


# Type alias for cleaner dependency injection
MatchmakingServiceDep = Annotated[
    MatchmakingAnalysisService, Depends(get_matchmaking_service)
]

__all__ = ["MatchmakingServiceDep", "get_matchmaking_service"]
