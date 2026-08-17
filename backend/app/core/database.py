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

        # Create async session factory
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
                await session.rollback()
                # FastAPI throws route HTTPExceptions into yield-dependencies,
                # so ordinary 4xx responses unwind through here; they are
                # already recorded by the request completion event and must
                # not warn like a real database failure.
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


# Global database manager instance
db_manager = DatabaseManager()


# Dependency for FastAPI routes
async def get_db() -> AsyncGenerator[AsyncSession]:
    """Fastapi dependency for getting a database session."""
    async with db_manager.get_session() as session:
        yield session


# Convenience function for getting a session in non-FastAPI contexts
async def get_session():
    """Get a database session."""
    async with db_manager.get_session() as session:
        return session
