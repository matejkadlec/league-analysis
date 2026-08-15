# Core infrastructure (app/core/)

- `RIOT_API_KEY_VERSION` identifies a deployment generation and must never
  contain or derive from the key itself. Never log or expose either value.
- Production readiness is `/health/ready`, not liveness-only `/health`: keep
  it secret-safe, and keep it failing unless a real database `SELECT 1`
  succeeds — container orchestration depends on the distinction.
