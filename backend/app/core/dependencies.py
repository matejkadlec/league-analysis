"""Core dependencies for FastAPI application."""

from collections.abc import AsyncGenerator
from fastapi import Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Annotated
import os

from . import get_db, get_riot_api_key
from .riot_api import RiotAPIClient

# from .riot_api import RiotDataManager # DELETED
from .riot_api.constants import Platform, Region


async def get_riot_client(
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AsyncGenerator[RiotAPIClient, None]:
    """Get Riot API client instance."""
    # Get API key from database or environment
    try:
        api_key = await get_riot_api_key(db)
    except ValueError:
        # Fallback to env var if DB key missing
        api_key = os.getenv("RIOT_API_KEY")

    if not api_key:
        api_key = os.getenv("RIOT_API_KEY")

    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="Riot API key not configured. Please add it via Settings page or .env file.",
        )

    # Use default region and platform
    region = Region("europe")
    platform = Platform("eun1")

    client = RiotAPIClient(api_key=api_key, region=region, platform=platform)
    await client.start_session()
    try:
        yield client
    finally:
        await client.close()


# Removed RiotDataManager dependency
# async def get_riot_data_manager(
#     db: Annotated[AsyncSession, Depends(get_db)],
#     riot_client: Annotated[RiotAPIClient, Depends(get_riot_client)],
# ) -> RiotDataManager:
#     """Get Riot data manager instance."""
#     return RiotDataManager(db, riot_client)


# Type aliases for cleaner dependency injection
# RiotDataManagerDep = Annotated[RiotDataManager, Depends(get_riot_data_manager)]

__all__ = ["get_riot_client"]
