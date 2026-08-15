# Core infrastructure (app/core/)

Shared backend infrastructure. Features depend on core; core never depends on
features. Sessions from `app.core.database.get_db`; the Riot client dependency
is `app.core.dependencies.get_riot_client`.

- Riot key lookup: active non-expired `core.riot_api_keys` row first,
  `RIOT_API_KEY` from `.env` only as fallback. Runtime callers use the tracked
  client factory so direct Riot acceptance/rejection updates the secret-free
  health record. `RIOT_API_KEY_VERSION` identifies a deployment generation and
  must never contain or derive from the key. Never expose either value.
- Settings load from the repo-root `.env` via Pydantic settings
  (`app/core/config.py` is the field inventory).
- Production readiness is `/health/ready`, not liveness-only `/health`: keep
  it secret-safe and failing unless a real database `SELECT 1` succeeds —
  container orchestration depends on the distinction.
