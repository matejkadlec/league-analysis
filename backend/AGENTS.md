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
- Features depend on core, never the reverse. Feature `__init__.py` files carry
  no imports at all — a name forwarded there runs the feature's router and
  service on any submodule import — so import from submodules directly; the
  `forbid-feature-init-imports` pre-commit hook rejects the re-export. Keep
  routes thin and logic in services.
- Log through `structlog.get_logger(__name__)` with structured key-value
  fields. Event names are static snake_case identifiers — never interpolate
  values into the event string — and logs must never carry tokens,
  passwords, codes, or API keys.
- A comment carries at most two lines of prose, and consecutive comment lines
  count as one comment. Tool directives (`noqa`, `type: ignore`, `ruff:`,
  `pyright:`) do not count toward that total but do not split a run either. A
  docstring's prose past its summary line is under the same ceiling, with
  `Args:`/`Returns:`-style sections excepted; attribute docstrings, f-strings,
  and other bare string statements are read as docstrings too. Deferral markers
  (`TODO`, "for now") and backwards-compatibility markers are rejected in
  comments and docstrings alike. `scripts/check_comments.py` is the gate;
  `alembic/` is deliberately outside it, because revisions are immutable
  historical records whose prose narrates legacy transitions by design.

## Commands

```bash
../test.sh -b              # Repository tooling plus the complete backend gate
uv run pytest              # Focused backend regression suite
uv run python scripts/migrate.py upgrade head
uv run ruff check app tests scripts
uv run ruff format --check --exclude '*.md' app tests scripts
uv run python scripts/check_comments.py app tests scripts
uv run python scripts/check_tests.py tests
uv run pyright
uv run bandit --quiet --recursive app scripts --severity-level medium --confidence-level medium --skip B104
uv run vulture
uv run deptry .
../scripts/run-xenon.sh    # Rank B (CC <= 10) over app/
```

The authoritative gate runs dependency sync from `uv.lock` before these checks.
Tests are network-free and receive safe test-only environment values from the
gate; they must not depend on a real Riot API key or production credentials.

`tests/integration/` is the one exception, and it is opt-in: each file carries
`@pytest.mark.integration` and `@pytest.mark.enable_socket`, and the session
fixture builds a throwaway `lga_integration_tests_<uuid>` database from the
`POSTGRES_*` environment, migrates it with `scripts/migrate.py upgrade head`,
and hands out sessions inside a rolled-back outer transaction. It exists for
the claims a compiled statement cannot make -- an `ON CONFLICT` target with no
unique index behind it, JSONB `None` versus SQL NULL versus JSON `null`, a
native enum with no `ALTER TYPE`, a server default, a trigger. With no
PostgreSQL reachable it skips rather than fails, so `../test.sh -b` on a
developer host is unaffected; run it for real with
`docker compose -f compose.gate.yml run --rm gate -b`.

A test states a rule the code must satisfy, never a copy of the code's current
value, and its falsifiability is proven by mutating the production code rather
than by reading it. `scripts/check_tests.py` and Ruff's `PT` rules enforce the
mechanical part; the standard itself is in
[`../docs/quality-checks.md`](../docs/quality-checks.md#what-makes-a-test-worth-keeping).

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
hidden prompt or standard input, hashes through the shared
`app.features.auth.passwords` Argon2id helpers and authenticates through
`AuthService`, and refuses any database other than the exact loopback
`league_analysis_local_dev` target.
The post-authority `scripts/mirror_pi_postgres_to_local.py` path accepts only a
read-only Pi export, restores into a local staging database, and keeps durable
rollback state through the atomic local name swap. It compares the live Pi and
local Alembic heads before export and refuses a schema mismatch without changing
the local database; the installed mirror is not pinned to the migration head
that existed when its local snapshot was installed.

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
