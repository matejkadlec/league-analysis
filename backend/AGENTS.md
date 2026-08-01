# Backend (`backend/`)

> **Scope:** Backend-wide architecture and Python conventions under `backend/`.
>
> **Maintenance:** Update when the backend stack, feature layout, shared
> conventions, or backend validation commands change.

Repository identity, delivery workflow, and safety rules are inherited from
[`../AGENTS.md`](../AGENTS.md). This guide may add backend constraints but may
not weaken repository-wide rules.

## Tech Stack

Python 3.14.6, FastAPI, SQLAlchemy 2.0+, Pydantic v2, structlog, APScheduler, httpx

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
../test.sh -b              # Repository tooling plus the complete backend gate
uv run pytest              # Focused backend regression suite
uv run ruff check app tests ../scripts/*.py
uv run ruff format --check --exclude '*.md' app tests ../scripts/*.py
uv run pyright
uv run bandit --quiet --recursive app --severity-level medium --confidence-level medium --skip B104
```

The authoritative gate runs dependency sync from `uv.lock` before these checks.
Tests are network-free and receive safe test-only environment values from the
gate; they must not depend on a real Riot API key or production credentials.

## Related Docs

- [core/AGENTS.md](app/core/AGENTS.md) - Core infrastructure
- [core/riot_api/AGENTS.md](app/core/riot_api/AGENTS.md) - Riot API client
- [features/AGENTS.md](app/features/AGENTS.md) - Feature patterns
- [features/jobs/AGENTS.md](app/features/jobs/AGENTS.md) - Job implementation
- [COOKIE_CONSENT_AGENTS.md](COOKIE_CONSENT_AGENTS.md) - Cookie-consent compliance and implementation checklist
- [Project overview](../docs/project-overview.md) - Runtime and validation commands
