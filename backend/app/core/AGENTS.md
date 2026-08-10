# Core Infrastructure (`app/core/`)

> **Scope:** Shared backend infrastructure under `backend/app/core/`.
>
> **Maintenance:** Update when core modules, dependency direction,
> configuration, database sessions, validation, or shared infrastructure
> changes.

Inherits repository-wide rules from [`../../../AGENTS.md`](../../../AGENTS.md)
and backend rules from [`../../AGENTS.md`](../../AGENTS.md).

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

Riot API key lookup prefers an active, non-expired row in
`core.riot_api_keys` and falls back to `RIOT_API_KEY` from `.env` only when no
valid database key exists. Never expose either value.

Key settings (from `.env`):

- `postgres_*` - Database connection
- `cors_origins` - CORS for frontend
- `jwt_secret_key` - JWT signing
- `jwt_access_token_expire_minutes` / `jwt_refresh_token_expire_days` - Access/refresh lifetimes
- `auth_lockout_max_attempts` / `auth_lockout_minutes` - Login lockout policy
- `auth_captcha_after_failures` - Failed-attempt threshold for CAPTCHA
- `turnstile_secret_key` - Server-side Turnstile verification secret
- `smtp_*` + `smtp_use_tls` / `smtp_use_ssl` - Outbound SMTP transport for verification/contact emails

For normal local `./run.sh` launches, the protected `.env` is authoritative:
the launcher clears inherited backend configuration names first, then loads the
worktree file. Use `LGA_RUN_USE_PROCESS_ENV=1` only for a deliberate one-off
override; this avoids WSL variables from another worktree selecting a wrong
database or invalid setting value.

Production readiness is `/health/ready`, not the liveness-only `/health` route.
Keep readiness secret-safe and fail it unless a real database `SELECT 1`
succeeds; container orchestration depends on this distinction.
