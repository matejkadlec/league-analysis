# Core Infrastructure (`app/core/`)

> **Scope:** Shared backend infrastructure boundaries under
> `backend/app/core/`.
>
> **Maintenance:** Update when a dependency-direction rule, configuration
> contract, or health/credential boundary changes. Module inventories and
> usage examples live in the code.

Inherits repository-wide rules from [`../../../AGENTS.md`](../../../AGENTS.md)
and backend rules from [`../../AGENTS.md`](../../AGENTS.md).

Shared infrastructure for all features. Features depend on core, **core NEVER
depends on features**. Sessions come from `app.core.database.get_db`; the Riot
client dependency is `app.core.dependencies.get_riot_client`; the Riot client
package has its own guide ([riot_api/AGENTS.md](riot_api/AGENTS.md)).

## Configuration and Credential Boundaries

Riot API key lookup prefers an active, non-expired row in
`core.riot_api_keys` and falls back to `RIOT_API_KEY` from `.env` only when no
valid database key exists. Runtime callers use the tracked client factory so
direct Riot acceptance/rejection updates the secret-free current-generation
health record. `RIOT_API_KEY_VERSION` may identify an environment deployment
generation; it must never contain or derive from the key. Never expose either
credential value.

Settings load from the repository-root `.env` through Pydantic settings
(`app/core/config.py` is the field inventory). For normal local `./run.sh`
launches, the protected `.env` is authoritative: the launcher clears inherited
backend configuration names first, then loads the worktree file. Use
`LGA_RUN_USE_PROCESS_ENV=1` only for a deliberate one-off override; this
avoids WSL variables from another worktree selecting a wrong database or
invalid setting value.

Production readiness is `/health/ready`, not the liveness-only `/health` route.
Keep readiness secret-safe and fail it unless a real database `SELECT 1`
succeeds; container orchestration depends on this distinction.
