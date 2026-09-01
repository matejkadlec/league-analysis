"""Database connection and session management for PostgreSQL using SQLAlchemy with async support."""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import structlog
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from .config import get_global_settings
from .db_session import rollback_quietly

logger = structlog.get_logger(__name__)


class DatabaseManager:
    """Database connection and session manager."""

    def __init__(self):
        """Initialize database manager with async engine."""
        settings = get_global_settings()
        self.database_url = settings.database_url

        # Atomic local mirror swaps terminate connections to the replaced database.
        # Pre-ping discards those stale pooled connections before a request uses them.
        self.engine = create_async_engine(
            self.database_url,
            echo=settings.debug,  # Enable SQL logging in debug mode
            future=True,
            pool_pre_ping=True,
        )

        self.async_session_factory = async_sessionmaker(
            self.engine,
            class_=AsyncSession,
            expire_on_commit=False,
            autoflush=False,
        )

    @asynccontextmanager
    async def get_session(self) -> AsyncGenerator[AsyncSession]:
        """Get a database session with proper cleanup."""
        async with self.async_session_factory() as session:
            try:
                yield session
            except Exception as error:
                await rollback_quietly(session)
                # FastAPI throws route HTTPExceptions into yield-dependencies, so
                # ordinary 4xx must not warn like a real database failure.
                log = (
                    logger.debug if isinstance(error, HTTPException) else logger.warning
                )
                log("database_session_rollback", error_type=type(error).__name__)
                raise
            finally:
                await session.close()

    async def close(self) -> None:
        """Close database connections."""
        await self.engine.dispose()


db_manager = DatabaseManager()


async def get_db() -> AsyncGenerator[AsyncSession]:
    """Fastapi dependency for getting a database session."""
    async with db_manager.get_session() as session:
        yield session
