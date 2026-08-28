"""Main FastAPI application for League Analysis Backend."""

import logging
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from sqlalchemy import text
from starlette.middleware.body_limit import RequestBodyLimitMiddleware
from structlog import contextvars as structlog_contextvars

from app.core.config import get_global_settings
from app.core.database import db_manager
from app.core.http_errors import SERVICE_ERROR_DETAIL
from app.core.http_rate_limit import limiter
from app.core.request_logging import RequestLoggingMiddleware
from app.features.auth.router import router as auth_router
from app.features.jobs.log_capture import job_log_capture
from app.features.jobs.router import router as jobs_router
from app.features.jobs.scheduler import (
    StartupRecoveryError,
    shutdown_scheduler,
    start_scheduler,
)
from app.features.matches.router import router as matches_router
from app.features.matchmaking_analysis.router import router as matchmaking_router
from app.features.players.router import router as players_router
from app.features.playstyle_analysis.router import router as playstyle_analysis_router
from app.features.settings.router import router as settings_router
from app.features.smurf_boost_detection.router import (
    router as smurf_boost_router,
)

settings = get_global_settings()
logging.basicConfig(
    level=settings.log_level,
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


async def _start_scheduler_safely() -> None:
    """Start job scheduler with error handling.

    A failed scheduler is degraded but serviceable, so it must not stop the
    application. `StartupRecoveryError` is the exception: it means persisted
    state was stranded, and serving would look healthy while polls never finish.
    """
    try:
        scheduler = await start_scheduler()
        if scheduler:
            logger.info("Job scheduler started")
    except StartupRecoveryError as e:
        logger.error(
            "startup_recovery_failed",
            error=str(e),
            error_type="StartupRecoveryError",
        )
        raise
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
    await _start_scheduler_safely()
    yield
    logger.info("Shutting down League Analysis Backend")
    await _shutdown_scheduler_safely()


tags_metadata = [
    {"name": "authentication", "description": "Authentication and user management."},
    {"name": "players", "description": "Player search and management."},
    {"name": "matches", "description": "Match history and analysis."},
    {"name": "playstyle-analysis", "description": "Playstyle analysis algorithms."},
    {"name": "jobs", "description": "Background job management."},
    {"name": "settings", "description": "System settings."},
    {"name": "matchmaking-analysis", "description": "Matchmaking fairness analysis."},
    {
        "name": "smurf-boost-detection",
        "description": "Explainable smurfing and boosting indicators.",
    },
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


@app.exception_handler(Exception)
async def unhandled_exception(_request: Request, _exc: Exception) -> JSONResponse:
    """Answer one client-safe body for every error a route did not map.

    Routes used to repeat this tail themselves; the exception still reaches
    the request-logging middleware, which records it with its traceback.
    """
    return JSONResponse(status_code=500, content={"detail": SERVICE_ERROR_DETAIL})


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# No endpoint accepts an upload, so a mebibyte is far above anything legitimate;
# uncapped, one client can stream arbitrarily much into memory. Added before the
# logging middleware so that stays outermost and records the 413.
app.add_middleware(RequestBodyLimitMiddleware, max_body_size=1024 * 1024)

# Added after CORS so it runs outermost of the user middlewares, just inside
# Starlette's ServerErrorMiddleware, where it observes both response statuses
# and unhandled exceptions.
app.add_middleware(RequestLoggingMiddleware)

app.include_router(auth_router, prefix="/api/v1")
app.include_router(players_router, prefix="/api/v1")
app.include_router(matches_router, prefix="/api/v1")
app.include_router(playstyle_analysis_router, prefix="/api/v1")
app.include_router(jobs_router, prefix="/api/v1")
app.include_router(settings_router, prefix="/api/v1")
app.include_router(matchmaking_router, prefix="/api/v1")
app.include_router(smurf_boost_router, prefix="/api/v1")


@app.get("/health/ready", tags=["health"], response_model=None)
async def readiness_check() -> dict[str, str] | JSONResponse:
    """Report readiness only after a database round trip succeeds."""
    try:
        async with db_manager.get_session() as db:
            await db.execute(text("SELECT 1"))
    except Exception as error:
        logger.warning(
            "readiness_probe_failed",
            error_type=type(error).__name__,
        )
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"status": "unavailable", "database": "unavailable"},
        )

    return {"status": "ready", "database": "ready"}


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
