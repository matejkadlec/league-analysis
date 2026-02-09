# Riot API Client (`app/core/riot_api/`)

> **Keep this file updated** when modifying Riot API integration.

HTTP client for Riot Games API with rate limiting and error handling.

## Modules

| Module            | Description                                   |
| ----------------- | --------------------------------------------- |
| `client.py`       | `RiotAPIClient` - async HTTP client with auth |
| `rate_limiter.py` | Token bucket rate limiter                     |
| `endpoints.py`    | URL builders for Riot API endpoints           |
| `constants.py`    | Region, Platform, QueueType enums             |
| `models.py`       | Pydantic DTOs for API responses               |
| `errors.py`       | Custom exceptions (RateLimitError, etc.)      |
| `transformers.py` | API response → DB model conversion            |

## Usage

```python
from app.core.riot_api import RiotAPIClient

async with RiotAPIClient(api_key=api_key) as client:
    account = await client.get_account_by_puuid(puuid)
    matches = await client.get_match_list_by_puuid(puuid, queue=420)
    timeline = await client.get_match_timeline("EUN1_123456789")
```

## Rate Limiting

- Development keys: 20 req/1s, 100 req/2min
- Jobs use 1.2s delay between match requests
- 429 errors trigger `RateLimitError` with `retry_after`

## Constants

```python
from app.core.riot_api.constants import Platform, Region, QueueType

platform = Platform.EUN1
region = Region.EUROPE
queue = QueueType.RANKED_SOLO_5x5  # 420
```

## Related Docs

See [docs/riot-api.md](../../../../docs/riot-api.md) for full endpoint documentation.
