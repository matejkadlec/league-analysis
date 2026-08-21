"""One scope around the tracked Riot client.

Every Riot-writing caller needs the same two things: a missing durable
credential translated into ``AuthenticationError``, and a client whose
session opens and closes with the scope. This module owns both once;
each seam maps ``AuthenticationError`` onto its native error mode.
"""

from collections.abc import AsyncGenerator, Callable
from contextlib import asynccontextmanager
from typing import TypedDict, Unpack

from sqlalchemy.ext.asyncio import AsyncSession

from .client import RiotAPIClient
from .constants import Platform, Region
from .credential_health import create_tracked_riot_api_client
from .errors import AuthenticationError

NO_ACTIVE_RIOT_API_KEY_MESSAGE = "No active Riot API key configured"


class TrackedRiotClientOptions(TypedDict, total=False):
    """The keyword options `create_tracked_riot_api_client` accepts.

    Declared here so callers forward a checked set of options instead of an
    untyped `**kwargs`, while the factory keeps owning the default values.
    """

    region: Region | None
    platform: Platform | None
    request_callback: Callable[[str, int], None] | None


async def open_tracked_riot_client(
    db: AsyncSession,
    **client_options: Unpack[TrackedRiotClientOptions],
) -> RiotAPIClient:
    """Build the tracked client; a missing credential is AuthenticationError."""
    try:
        return await create_tracked_riot_api_client(db, **client_options)
    except ValueError as error:
        raise AuthenticationError(NO_ACTIVE_RIOT_API_KEY_MESSAGE) from error


@asynccontextmanager
async def tracked_riot_client(
    db: AsyncSession,
    **client_options: Unpack[TrackedRiotClientOptions],
) -> AsyncGenerator[RiotAPIClient]:
    """Open and close the tracked client within one scope."""
    async with await open_tracked_riot_client(db, **client_options) as client:
        yield client
