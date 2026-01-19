# Core Infrastructure (`app/core/`)

Shared infrastructure for all features. Features depend on core, **core NEVER depends on features**.

## Modules

### `database.py`

- `AsyncSessionLocal` - SQLAlchemy async session factory
- `get_db()` - FastAPI dependency for database sessions
- `async_engine` - Database engine with connection pooling

```python
from app.core.database import get_db

@router.get("/example")
async def example(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Player))
    return result.scalars().all()
```

### `config.py`

- `Settings` - Pydantic settings from env vars
- `get_settings()` - Cached settings dependency
- `get_riot_api_key(db)` - Get Riot API key from database

**Key settings**:

- `postgres_db`, `postgres_user`, `postgres_password`, `postgres_host`, `postgres_port` - DB connection
- `cors_origins` - CORS for frontend
- `log_level` - Logging verbosity
- `jwt_secret_key` - JWT signing secret

**⚠️ Riot API key stored in database, NOT in settings**

### `exceptions.py`

Base exceptions:

- `RiotAPIError` - Riot API failures
- `RateLimitError` - Rate limit exceeded (429)
- `PlayerNotFoundError` - Player not found (404)
- `DatabaseError` - DB operation failures

### `dependencies.py`

Core DI:

- `get_db()` - Database session
- `get_settings()` - Application settings
- `get_riot_api_client()` - Riot API client
- `get_riot_data_manager()` - Riot data manager (**prefer this over client**)

### `enums.py`

- `Tier` - Rank tiers (IRON, BRONZE, ... CHALLENGER)
- `Platform` - Riot platforms (NA1, EUW1, EUN1, KR, ...)
- `QueueType` - Queue types (RANKED_SOLO_5x5, ...)

### `models.py`

- `Base` - SQLAlchemy declarative base
- `BaseModel` - Abstract base with `id`, `created_at`, `updated_at`

### `validation.py`

- Riot ID validation (game name + tag line)
- PUUID format validation
- Platform code validation

### `decorators.py`

- `@retry_on_rate_limit` - Retry with exponential backoff
- `@circuit_breaker` - Circuit breaker for external APIs
- `@measure_performance` - Performance measurement

### `riot_api/`

Riot API client infrastructure. See `riot_api/AGENTS.md` for details.

## Rules

**Use RiotDataManager, not RiotAPIClient**:

```python
# ✅ Correct
from app.core.riot_api import RiotDataManager
data_manager = RiotDataManager()
player = await data_manager.get_summoner_by_puuid(puuid, platform, db)

# ❌ Wrong
from app.core.riot_api import RiotAPIClient
client = RiotAPIClient()
response = await client.get(url)  # Too low-level, no caching
```

**Structured logging**:

```python
import structlog
logger = structlog.get_logger()
logger.info("player_searched", puuid=puuid, platform=platform)
# NO f-strings in log messages
```
