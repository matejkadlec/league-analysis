# Core Infrastructure (`app/core/`)

> **Keep this file updated** when modifying core infrastructure.

Shared infrastructure for all features. Features depend on core, **core NEVER depends on features**.

## Modules

| Module            | Description                                                    |
| ----------------- | -------------------------------------------------------------- |
| `database.py`     | Async session management, `get_db()` dependency                |
| `config.py`       | Pydantic settings, `get_riot_api_key(db)`                      |
| `exceptions.py`   | Base exceptions (RiotAPIError, RateLimitError, etc.)           |
| `dependencies.py` | Core DI (`get_riot_client()`)                                  |
| `enums.py`        | Tier, Platform, QueueType enums                                |
| `models.py`       | SQLAlchemy Base and BaseModel                                  |
| `decorators.py`   | Retry, circuit breaker, performance                            |
| `validation.py`   | Riot ID, PUUID validation                                      |
| `riot_api/`       | Riot API client (see [riot_api/AGENTS.md](riot_api/AGENTS.md)) |

## Key Patterns

### Database Session

```python
from app.core.database import get_db

@router.get("/example")
async def example(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Player))
    return result.scalars().all()
```

### Riot API Client

```python
from app.core.dependencies import get_riot_client

@router.get("/example")
async def example(
    riot_client: RiotAPIClient = Depends(get_riot_client)
):
    account = await riot_client.get_account_by_puuid(puuid)
```

### Logging

```python
import structlog
logger = structlog.get_logger(__name__)
logger.info("action_completed", puuid=puuid, count=count)
```

## Configuration

**⚠️ Riot API key stored in `core.riot_api_keys` table, NOT in env vars**

Key settings (from `.env`):

- `postgres_*` - Database connection
- `cors_origins` - CORS for frontend
- `jwt_secret_key` - JWT signing
