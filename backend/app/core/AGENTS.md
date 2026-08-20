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

The Riot API key is the single non-expired row in `core.riot_api_keys`; there
is no environment fallback, and no past key is retained. Runtime callers use
the tracked client factory so direct Riot acceptance/rejection updates the
secret-free current-generation health record. Never expose the key value.

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
The async SQLAlchemy engine keeps `pool_pre_ping` enabled so an atomic local
mirror swap cannot hand a terminated pooled PostgreSQL connection to the next
request.
