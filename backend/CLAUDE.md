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

- Schema changes are reviewed Alembic revisions applied through the locked
  `scripts/migrate.py` (a pre-commit hook forbids `create_all`). The baseline
  revision is intentionally non-reversible, and no hook can see a runtime
  action — restore a verified backup rather than dropping a populated schema.
- Production image: installs from `uv.lock`, runs as non-root UID/GID 10001,
  read-only at runtime.
