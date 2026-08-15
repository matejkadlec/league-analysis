# Backend

Features live under `app/features/<name>/`; shared infrastructure under
`app/core/`. Features depend on core, never the reverse.

Tests are network-free and never need real credentials.

## Safety boundaries

- Schema changes are reviewed Alembic revisions applied through the locked
  `scripts/migrate.py` (a pre-commit hook forbids `create_all`). The baseline
  revision is intentionally non-reversible, and no hook can see a runtime
  action — restore a verified backup rather than dropping a populated schema.
- Production image: installs from `uv.lock`, runs as non-root UID/GID 10001,
  read-only at runtime.
