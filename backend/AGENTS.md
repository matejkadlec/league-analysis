# Backend (`backend/`)

> **Keep this file updated** when making backend changes.

## Tech Stack

Python 3.13, FastAPI, SQLAlchemy 2.0+, Pydantic v2, structlog, APScheduler, httpx

## Structure

```
backend/app/
├── main.py              # App init, router registration
├── core/                # Infrastructure (see core/AGENTS.md)
│   └── riot_api/        # Riot API client (see riot_api/AGENTS.md)
└── features/            # Domain features (see features/AGENTS.md)
    ├── auth/
    ├── jobs/            # Background tasks (see jobs/AGENTS.md)
    ├── matches/
    ├── matchmaking_analysis/
    ├── players/
    ├── playstyle_analysis/
    └── settings/
```

Each feature contains: `router.py`, `service.py`, `models.py`, `schemas.py`, `dependencies.py`

## Code Patterns

### Imports

```python
# Core
from app.core.database import get_db
from app.core.config import get_settings
from app.core.riot_api import RiotAPIClient

# Features (public API)
from app.features.players import PlayerService, Player
```

### Dependency Injection

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

### Logging

```python
import structlog
logger = structlog.get_logger(__name__)
logger.info("action_completed", puuid=puuid, count=count)
```

## Rules

- async/await for all I/O
- Type hints everywhere
- Features depend on core, never reverse
- Thin routes, logic in services
- Features expose public APIs via `__init__.py`

## Commands

```bash
uv run pytest              # Run tests
uv run pytest --cov=app    # With coverage
uv run pyright             # Type check
```

## Related Docs

- [core/AGENTS.md](app/core/AGENTS.md) - Core infrastructure
- [core/riot_api/AGENTS.md](app/core/riot_api/AGENTS.md) - Riot API client
- [features/AGENTS.md](app/features/AGENTS.md) - Feature patterns
- [features/jobs/AGENTS.md](app/features/jobs/AGENTS.md) - Job implementation
