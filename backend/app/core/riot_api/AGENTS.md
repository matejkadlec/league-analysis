# Riot API (`app/core/riot_api/`)

Riot API integration with rate limiting, caching, and data transformation.

## Modules

- `client.py` - HTTP client with auth and rate limiting
- `data_manager.py` - Primary interface (database-first caching)
- `rate_limiter.py` - Token bucket rate limiter
- `transformers.py` - API response → DB model conversion
- `endpoints.py` - Riot API endpoint definitions
- `constants.py` - Region, platform, queue enums

## Rules

**ALWAYS use RiotDataManager**:

```python
# ✅ Correct
from app.core.riot_api import RiotDataManager
dm = RiotDataManager()
player = await dm.get_summoner_by_puuid(puuid, platform, db)

# ❌ Wrong - don't call RiotAPIClient directly
from app.core.riot_api import RiotAPIClient
```

**Handle rate limits**:

- API calls return `None` when rate limited
- Always check for `None` returns
- Update RIOT_API_KEY in database for 403 errors

**Use enum constants**:

```python
from app.core.riot_api.constants import Platform
platform = Platform.EUN1  # Not "eun1"
```

## Data Flow

1. Request → RiotDataManager
2. Check database cache
3. If miss, call RiotAPIClient
4. Transform response via transformers
5. Store in database
6. Return data
