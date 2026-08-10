# Backend (`backend/`)

> **Scope:** Backend-wide architecture and Python conventions under `backend/`.
>
> **Maintenance:** Update when the backend stack, feature layout, shared
> conventions, or backend validation commands change.

Repository identity, delivery workflow, and safety rules are inherited from
[`../AGENTS.md`](../AGENTS.md). This guide may add backend constraints but may
not weaken repository-wide rules.

## Tech Stack

Python 3.14.6, FastAPI 0.141+, SQLAlchemy 2.0+, Alembic 1.18+, Pydantic v2,
structlog 26, APScheduler 3.11, httpx 0.28

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
uv run python scripts/migrate.py upgrade head
uv run ruff check app tests scripts ../scripts/*.py
uv run ruff format --check --exclude '*.md' app tests scripts ../scripts/*.py
uv run pyright
uv run bandit --quiet --recursive app --severity-level medium --confidence-level medium --skip B104
```

The authoritative gate runs dependency sync from `uv.lock` before these checks.
Tests are network-free and receive safe test-only environment values from the
gate; they must not depend on a real Riot API key or production credentials.

Never call `Base.metadata.create_all()` for application schemas. Create a
reviewed Alembic revision for every schema/model change, include PostgreSQL-only
objects explicitly, and apply it through the locked `scripts/migrate.py`
command. The baseline revision is intentionally non-reversible; restore a
verified backup rather than dropping a populated application schema.
The repository-root `run.sh` applies `upgrade head` before starting application
writers and aborts startup if migration fails. Populated unmarked databases
must first pass the explicit `scripts/adopt_migrations.py` verification and
`--apply` flow documented in `docs/database.md`.

The local Riot-data cleanup command also owns its persistent regular-job
maintenance interlock. Do not bypass `config_json.riot_maintenance_mode` in a
Riot writer, including matchmaking-analysis persistence, or clear it through
an administrator update; cleanup refuses to proceed unless exactly one regular
configuration exists for each writer type, and the documented resume command
re-verifies the local target and inactive writers first.

`scripts/reconcile_admin_account.py` is the guarded local-only path for a
deliberate administrator reconciliation. It accepts passwords only through a
hidden prompt or standard input, uses `AuthService`'s normal Argon2id and
authentication path, and refuses any database other than the exact loopback
`league_analysis_local_dev` target. The one-time LGA-79 migration wrapper is
`scripts/migrate_local_postgres_to_pi.py`; it is disabled after the Pi records
its durable authority marker. Follow the ordered procedure and rollback gate in
[`../docs/deployment.md`](../docs/deployment.md#postgresql-data-authority-and-initial-migration).

The production backend image is defined by `Dockerfile`. It installs from
`uv.lock`, runs Uvicorn without reload as non-root UID/GID 10001, and is
read-only at runtime. `compose.production.yml` owns the separate one-shot
migration service and probes `/health/ready`, which must include a database
round trip. Scheduler shutdown must remain non-draining (`wait=False`) so
deployments cannot block on normal long-running Riot jobs; startup recovery
owns classification of interrupted persisted executions.

## Related Docs

- [core/AGENTS.md](app/core/AGENTS.md) - Core infrastructure
- [core/riot_api/AGENTS.md](app/core/riot_api/AGENTS.md) - Riot API client
- [features/AGENTS.md](app/features/AGENTS.md) - Feature patterns
- [features/jobs/AGENTS.md](app/features/jobs/AGENTS.md) - Job implementation
- [COOKIE_CONSENT_AGENTS.md](COOKIE_CONSENT_AGENTS.md) - Cookie-consent compliance and implementation checklist
- [Project overview](../docs/project-overview.md) - Runtime and validation commands
