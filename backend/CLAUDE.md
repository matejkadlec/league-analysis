# Backend

Stack: Python 3.14 (pinned by `.python-version`), FastAPI, SQLAlchemy 2 async,
Alembic, Pydantic v2, structlog, APScheduler, httpx; uv for dependencies and
commands. Features live under `app/features/<name>/` (`router.py`,
`service.py`, `models.py`, `schemas.py`, `dependencies.py`); shared
infrastructure under `app/core/`.

- async/await for all I/O; type hints everywhere.
- Features depend on core, never the reverse. Public APIs via `__init__.py`;
  routes thin, logic in services.
- Log through `structlog.get_logger(__name__)` with structured key-value
  fields.

Commands: `../test.sh -b`, `uv run pytest`, `uv run python
scripts/migrate.py upgrade head`, `uv run ruff check app tests scripts
../scripts/*.py`, `uv run ruff format --check --exclude '*.md' app tests
scripts ../scripts/*.py`, `uv run pyright`, `uv run bandit --quiet
--recursive app scripts --severity-level medium --confidence-level medium
--skip B104`, `uv run vulture`, `uv run deptry .`, `../scripts/run-xenon.sh`
(rank B, CC <= 10). Tests are network-free and never need real credentials.

## Safety boundaries

- Never `Base.metadata.create_all()` for application schemas: every
  schema/model change is a reviewed Alembic revision applied through the
  locked `scripts/migrate.py`. The baseline revision is intentionally
  non-reversible — restore a verified backup rather than dropping a
  populated schema. `run.sh` applies `upgrade head` before starting writers
  and aborts on failure.
- The local Riot-data cleanup command owns the
  `config_json.riot_maintenance_mode` interlock: never bypass it in a Riot
  writer or clear it through an administrator update.
- Production image: installs from `uv.lock`, runs as non-root UID/GID 10001,
  read-only at runtime; `/health/ready` must include a database round trip;
  scheduler shutdown stays non-draining (`wait=False`) — startup recovery
  classifies interrupted persisted executions.
