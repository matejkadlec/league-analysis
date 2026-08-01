"""Core dependencies for FastAPI application."""

import os
from collections.abc import AsyncGenerator
from typing import Annotated

from fastapi import Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from . import get_db, get_riot_api_key
from .riot_api import RiotAPIClient
from .riot_api.constants import Platform, Region


async def get_riot_client(
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AsyncGenerator[RiotAPIClient, None]:
    """Get Riot API client instance."""
    try:
        api_key = await get_riot_api_key(db)
    except ValueError:
        api_key = os.getenv("RIOT_API_KEY")

    if not api_key:
        api_key = os.getenv("RIOT_API_KEY")

    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="Riot API key not configured. Please add it via Settings page or .env file.",
        )

    region = Region("europe")
    platform = Platform("eun1")

    client = RiotAPIClient(api_key=api_key, region=region, platform=platform)
    await client.start_session()
    try:
        yield client
    finally:
        await client.close()


__all__ = ["get_riot_client"]
