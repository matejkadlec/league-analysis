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
- Treat Account-V1 `gameName`/`tagLine` and mode-sensitive participant fields
  as optional. Missing identity fields must preserve a known Riot ID; legacy
  `summonerName` is only a new-record/display fallback.
- Keep the Riot queue reference catalog separate from the product allowlist
  (420, 440, 480, 400, 450, 2400). Reject unknown queue/type/platform inputs
  before I/O. Match Fetcher always consumes the complete product allowlist;
  persisted job configuration cannot narrow it.
- Treat `leagueId` and `puuid` as optional metadata in League-V4 by-PUUID
  entries. Keep queue and ranked-result fields strict so genuine response-shape
  drift remains visible without rejecting the current payload.
- Preserve both rate-limit layers. Per-client windows are routing/service
  scoped and keep their original observed start; database coordination keeps
  cross-component priority. Do not bypass acquisition/recording, spacing,
  `Retry-After`, or 429 behavior.
- Credential lookup is implemented by `app.core.config.get_riot_api_key`: an
  active, non-expired `core.riot_api_keys` row has priority, with
  `RIOT_API_KEY` as the development fallback.
- Never log or expose an API key.
- A Riot 400 whose `status.message` reports a decryption failure becomes
  `PuuidDecryptionError`, not a plain `BadRequestError`. It means the stored
  PUUID belongs to another developer account. Keep the condition on the
  exception type and keep the provider payload out of the message.

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
