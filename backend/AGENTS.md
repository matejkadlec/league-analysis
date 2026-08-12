# Backend (`backend/`)

> **Scope:** Backend-wide constraints and safety rules under `backend/`.
>
> **Maintenance:** Update when a backend-wide rule, safety boundary, or
> validation command changes. Structure, patterns, and module inventories live
> in the code; do not mirror them here.

Repository identity, delivery workflow, and safety rules are inherited from
[`../AGENTS.md`](../AGENTS.md). This guide may add backend constraints but may
not weaken repository-wide rules.

Stack: Python 3.14 (pinned by `.python-version`), FastAPI, SQLAlchemy 2 async,
Alembic, Pydantic v2, structlog, APScheduler, httpx. Features live under
`app/features/<name>/` (`router.py`, `service.py`, `models.py`, `schemas.py`,
`dependencies.py`); shared infrastructure lives under `app/core/`.

## Rules

- async/await for all I/O; type hints everywhere.
- Features depend on core, never the reverse. Features expose public APIs via
  `__init__.py`; keep routes thin and logic in services.
- Log through `structlog.get_logger(__name__)` with structured key-value
  fields.

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

## Safety Boundaries

Never call `Base.metadata.create_all()` for application schemas. Create a
reviewed Alembic revision for every schema/model change, include PostgreSQL-only
objects explicitly, and apply it through the locked `scripts/migrate.py`
command. The baseline revision is intentionally non-reversible; restore a
verified backup rather than dropping a populated application schema.
The repository-root `run.sh` applies `upgrade head` before starting application
writers and aborts startup if migration fails.

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
`league_analysis_local_dev` target.
The post-authority `scripts/mirror_pi_postgres_to_local.py` path accepts only a
read-only Pi export, restores into a local staging database, and keeps durable
rollback state through the atomic local name swap.

The production backend image is defined by `Dockerfile`. It installs from
`uv.lock`, runs Uvicorn without reload as non-root UID/GID 10001, and is
read-only at runtime. `compose.production.yml` owns the separate one-shot
migration service and probes `/health/ready`, which must include a database
round trip. Scheduler shutdown must remain non-draining (`wait=False`) so
deployments cannot block on normal long-running Riot jobs; startup recovery
owns classification of interrupted persisted executions.

## Related Docs

- [core/AGENTS.md](app/core/AGENTS.md) - Core infrastructure boundaries
- [core/riot_api/AGENTS.md](app/core/riot_api/AGENTS.md) - Riot API client boundaries
- [features/AGENTS.md](app/features/AGENTS.md) - Feature boundaries
- [features/jobs/AGENTS.md](app/features/jobs/AGENTS.md) - Job invariants
- [COOKIE_CONSENT_AGENTS.md](COOKIE_CONSENT_AGENTS.md) - Cookie-consent compliance and implementation checklist
- [Project overview](../docs/project-overview.md) - Runtime and validation commands
