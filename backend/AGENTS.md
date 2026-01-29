# Tech Stack

Python 3.13, FastAPI, SQLAlchemy 2.0+, Pydantic v2, structlog, APScheduler, httpx, pytest

# Structure

**Feature-based**: Related code grouped by domain

## Core (`app/core/`)

- `database.py` - Session management
- `config.py` - Settings, env vars
- `exceptions.py` - Base exceptions
- `dependencies.py` - Core DI
- `enums.py` - Shared enums (Tier, Platform)
- `models.py` - Base SQLAlchemy model
- `decorators.py` - Retry, circuit breaker
- `validation.py` - Shared validators
- `riot_api/` - Riot API client (see `riot_api/AGENTS.md`)

## Features (`app/features/`)

Each feature: `router.py`, `service.py`, `models.py`, `schemas.py`, `dependencies.py`

- `players/` - Search, tracking, rank
- `matches/` - Match history, stats
- `playstyle_analysis/` - Playstyle analysis and stats
- `matchmaking_analysis/` - Fairness evaluation
- `jobs/` - Background tasks (see feature AGENTS.md)
- `settings/` - Runtime config

# Rules

**Architecture**:

- Features depend on core, never reverse
- Features expose public APIs via `__init__.py`

**Code**:

- async/await for all I/O
- Type hints everywhere
- structlog with context keys: `logger.info("action", puuid=puuid)`
- Thin routes, logic in services

**Imports**:

```python
# Core
from app.core.database import get_db
from app.core.config import get_settings
from app.core.riot_api import RiotDataManager
from app.core.enums import Tier, Platform

# Features (public API)
from app.features.players import PlayerService, Player
from app.features.matches import MatchService

# Features (direct)
from app.features.players.service import PlayerService
```

**Dependency injection**:

```python
from fastapi import Depends
from app.features.players.dependencies import get_player_service

@router.get("/players/{puuid}")
async def get_player(
    puuid: str,
    player_service: PlayerService = Depends(get_player_service)
):
    return await player_service.get_player(puuid)
```

# Commands

```bash
# Tests
docker compose exec backend uv run pytest
docker compose exec backend uv run pytest --cov=app

# Rebuild (if dependencies change)
docker compose build backend

# Type check
docker compose exec backend uv run pyright
```

# Add New Feature

1. Create `app/features/my_feature/`
2. Add standard files: `__init__.py`, `router.py`, `service.py`, `models.py`, `schemas.py`, `dependencies.py`
3. Register router in `main.py`:
   ```python
   from app.features.my_feature import my_feature_router
   app.include_router(my_feature_router, prefix="/api/v1", tags=["my_feature"])
   ```
