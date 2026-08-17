"""Core dependencies for FastAPI application."""

from collections.abc import AsyncGenerator
from typing import Annotated

import structlog
from fastapi import Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from . import get_db
from .riot_api import RiotAPIClient
from .riot_api.constants import Platform, Region
from .riot_api.credential_health import create_tracked_riot_api_client

logger = structlog.get_logger(__name__)


async def get_riot_client(
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AsyncGenerator[RiotAPIClient]:
    """Get Riot API client instance."""
    try:
        client = await create_tracked_riot_api_client(
            db,
            region=Region("europe"),
            platform=Platform("eun1"),
        )
    except ValueError as error:
        logger.warning(
            "riot_api_key_not_configured",
            hint="Get your key from https://developer.riotgames.com",
        )
        raise HTTPException(
            status_code=503,
            detail="Riot data is unavailable because no Riot API key is configured. An administrator can add one on the Settings page.",
        ) from error

    await client.start_session()
    try:
        yield client
    finally:
        await client.close()


__all__ = ["get_riot_client"]
