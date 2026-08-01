# Riot API Client (`app/core/riot_api/`)

> **Scope:** Riot HTTP client, routing, DTOs, transformations, and rate-limit
> infrastructure under `backend/app/core/riot_api/`.
>
> **Maintenance:** Update when a Riot endpoint, route mapping, response model,
> error, transformer, credential flow, or rate-limit implementation changes.

Inherits repository-wide rules from
[`../../../../AGENTS.md`](../../../../AGENTS.md), backend rules from
[`../../../AGENTS.md`](../../../AGENTS.md), and core dependency boundaries from
[`../AGENTS.md`](../AGENTS.md).

## Modules

| Module | Responsibility |
| --- | --- |
| `client.py` | Async `httpx` client, authentication header, response parsing, and callbacks |
| `endpoints.py` | Regional/platform URL builders and rate-limit header parsers |
| `constants.py` | `Region`, `Platform`, `QueueType`, and platform-to-region mapping |
| `models.py` | Pydantic DTOs for Riot responses |
| `errors.py` | Riot-specific exception types |
| `transformers.py` | Riot payload to application-model transformations |
| `rate_limiter.py` | Per-client adaptive app/method limit tracking from Riot headers |
| `db_rate_limiter.py` | Cross-component database coordination and priority |

## Boundaries

- Use regional routing for Account-V1 and Match-V5 and platform routing for
  Summoner-V4 and League-V4.
- Use PUUID as the durable player identifier.
- Keep HTTP I/O async and validate responses through the DTO layer.
- Preserve both rate-limit layers. Do not bypass acquisition/recording,
  priority, spacing, `Retry-After`, or 429 behavior.
- Credential lookup is implemented by `app.core.config.get_riot_api_key`: an
  active, non-expired `core.riot_api_keys` row has priority, with
  `RIOT_API_KEY` as the development fallback.
- Never log or expose an API key.

## Usage

```python
from app.core.riot_api import RiotAPIClient

async with RiotAPIClient(api_key=api_key) as client:
    account = await client.get_account_by_puuid(puuid)
    matches = await client.get_match_list_by_puuid(puuid, queue=420)
    timeline = await client.get_match_timeline("EUN1_123456789")
```

[`../../../../docs/riot-api.md`](../../../../docs/riot-api.md) is authoritative
for endpoints, routing, credential precedence, and rate-limit behavior. Update
it with any integration change.
