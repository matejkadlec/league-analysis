"""Main FastAPI application for League Analysis Backend."""

import logging
from contextlib import asynccontextmanager
from typing import Any, Dict

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from structlog import contextvars as structlog_contextvars

from app.core import get_global_settings, get_riot_api_key
from app.core.database import db_manager
from app.core.rate_limiter import limiter
from app.features.auth import auth_router
from app.features.jobs import (
    job_log_capture,
    jobs_router,
    shutdown_scheduler,
    start_scheduler,
)
from app.features.matches.router import router as matches_router
from app.features.matchmaking_analysis.router import router as matchmaking_router
from app.features.players.router import router as players_router
from app.features.playstyle_analysis.router import router as playstyle_analysis_router
from app.features.settings.router import router as settings_router

settings = get_global_settings()
logging.basicConfig(
    level=getattr(logging, settings.log_level.upper()),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = structlog.get_logger(__name__)

structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog_contextvars.merge_contextvars,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
        job_log_capture,
        structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.stdlib.BoundLogger,
    logger_factory=structlog.stdlib.LoggerFactory(),
    context_class=dict,
    cache_logger_on_first_use=True,
)


async def _validate_api_key_configuration() -> None:
    """Validate and log Riot API key configuration status."""
    try:
        async with db_manager.get_session() as db:
            api_key = await get_riot_api_key(db)
            if not api_key or api_key == "your_riot_api_key_here":
                logger.warning(
                    "⚠️  Riot API key not configured! Set it via web UI at /settings.",
                    hint="Get your key from https://developer.riotgames.com",
                )
            elif api_key.startswith("RGAPI-"):
                logger.info("✓ Riot API key configured (development key detected)")
                logger.warning(
                    "⚠️  Development API keys expire every 24 hours!",
                    hint="Update via web UI at /settings",
                )
            else:
                logger.info("✓ Riot API key configured")
    except ValueError:
        logger.warning(
            "⚠️  Riot API key not configured! Set it via web UI at /settings.",
            hint="Get your key from https://developer.riotgames.com",
        )
    except Exception as e:
        logger.warning("Could not validate API key configuration", error=str(e))


async def _start_scheduler_safely() -> None:
    """Start job scheduler with error handling."""
    try:
        scheduler = await start_scheduler()
        if scheduler:
            logger.info("Job scheduler started")
    except Exception as e:
        logger.error(
            "Failed to start job scheduler",
            error=str(e),
            error_type=type(e).__name__,
        )


async def _shutdown_scheduler_safely() -> None:
    """Shutdown job scheduler with error handling."""
    try:
        await shutdown_scheduler()
        logger.info("Job scheduler shut down")
    except Exception as e:
        logger.error(
            "Error during scheduler shutdown",
            error=str(e),
            error_type=type(e).__name__,
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    logger.info("Starting up League Analysis Backend")
    await _validate_api_key_configuration()
    await _start_scheduler_safely()
    yield
    logger.info("Shutting down League Analysis Backend")
    await _shutdown_scheduler_safely()


tags_metadata = [
    {"name": "auth", "description": "Authentication and user management."},
    {"name": "players", "description": "Player search and management."},
    {"name": "matches", "description": "Match history and analysis."},
    {"name": "playstyle-analysis", "description": "Playstyle analysis algorithms."},
    {"name": "jobs", "description": "Background job management."},
    {"name": "settings", "description": "System settings."},
    {"name": "matchmaking-analysis", "description": "Matchmaking fairness analysis."},
    {"name": "health", "description": "Health check endpoints."},
]

app = FastAPI(
    title="League Analysis",
    description="Web app for comprehensive analysis of League of Legends players and matches.",
    version="0.1.0",
    contact={
        "name": "League Analysis",
        "url": "https://github.com/matejkadlec/league-analysis",
    },
    license_info={
        "name": "All Rights Reserved",
        "url": "https://github.com/matejkadlec/league-analysis/blob/master/LICENSE",
    },
    docs_url="/api",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    openapi_tags=tags_metadata,
    lifespan=lifespan,
    debug=settings.debug,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api/v1/auth", tags=["authentication"])
app.include_router(players_router, prefix="/api/v1", tags=["players"])
app.include_router(matches_router, prefix="/api/v1", tags=["matches"])
app.include_router(
    playstyle_analysis_router, prefix="/api/v1", tags=["playstyle-analysis"]
)
app.include_router(jobs_router, prefix="/api/v1", tags=["jobs"])
app.include_router(settings_router, prefix="/api/v1", tags=["settings"])
app.include_router(matchmaking_router, prefix="/api/v1", tags=["matchmaking-analysis"])

# Legacy route compatibility
app.include_router(players_router)
app.include_router(matches_router)
app.include_router(playstyle_analysis_router)
app.include_router(jobs_router)


@app.get("/health", tags=["health"])
async def health_check() -> Dict[str, Any]:
    """Health check endpoint for monitoring and load balancers."""
    return {
        "status": "healthy",
        "message": "Application is running",
        "version": "0.1.0",
        "debug": settings.debug,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        # Direct execution intentionally serves WSL/LAN clients.
        host="0.0.0.0",
        port=8000,
        reload=settings.debug,
        log_level=settings.log_level.lower(),
    )
