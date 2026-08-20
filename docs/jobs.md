# Background Jobs Documentation

> **Authority:** Durable invariants, rationale, and operational contracts for
> the background job system. Implementations, routes, and schedules live in
> `backend/app/features/jobs/` and `jobs.job_configurations`; read the code for
> anything mechanical.
>
> **Maintenance:** Update this document only when a durable invariant, a
> decision's rationale, an external fact, or an operational procedure changes —
> not for mechanical job, route, or configuration code changes.

## Job Types and Lifecycle

Two APScheduler-managed regular writer jobs exist
(`backend/app/features/jobs/implementations/`): `MATCH_FETCHER` fetches new
matches for tracked players, updates Solo/Duo rank snapshots, and persists
per-match LP only when the surrounding snapshots prove one exact transition;
`PLAYER_UPDATER` refreshes tracked player profile identity. Execution states:
`PENDING` (queued) -> `RUNNING` (executing) <-> `PAUSED` (runtime checkpoint)
-> terminal `SUCCESS`, `FAILED`, `CANCELLED`, or `RATE_LIMITED`. Jobs process
the union of `auth.user_tracked_players` PUUIDs; the `/api/v1/jobs` API is
admin-only.

### Success vs failure semantics

For the two regular writers, isolated player/match/timeline/provider errors
are recoverable: the run continues and finishes `SUCCESS` with bounded,
secret-safe warning diagnostics in `execution_log` (the failure-only
`error_message` stays empty). A missing or Riot-rejected API key finishes
`FAILED` with `has_api_key_error=true`; rate exhaustion finishes
`RATE_LIMITED`; maintenance or operator stops finish `CANCELLED`; database and
execution-wide faults finish `FAILED` because continuing could corrupt or
misreport progress. Test runs keep fail-on-any-diagnostic semantics — they are
health checks, not best-effort batch writers.

`core.players.profile_synced_at`, `league_synced_at`, and `match_synced_at`
advance only on a clean owning check — including one that found nothing new.
Failed, cancelled, warning-bearing, or rate-limited work never advances them.

## Startup Recovery — Deliberately Asymmetric

On startup, recovery marks executions orphaned in `RUNNING`/`PAUSED`
`CANCELLED` and cancels **every** active (`pending`/`running`)
`jobs.player_sync_runs` row: the sync worker is in-process, so no such row can
still be owned, and because the start route attaches to an existing active
row, an orphan would permanently block that player's updates. This step is
mandatory — failure raises `StartupRecoveryError` and stops the application
rather than serving with rows no worker owns. Production containers use
`restart: unless-stopped`, so a failed recovery gets a clean retry.

`core.matchmaking_analyses` has the **opposite** contract: startup never
cancels it. A worker interrupted by shutdown deliberately leaves its run
active so the next explicit `start_analysis` reattaches and resumes with
completed progress intact; writing a terminal row would discard that work on
every deployment. Explicit user cancellation is unaffected — it commits the
`cancelled` row before cancelling the worker.

Pause is runtime-only: each run carries its own flag on its in-memory
runtime-control entry (test runs under the negated config ID), so the flag
dies with the run — nothing is persisted and nothing needs a startup reset.
The `job_configurations.is_paused` column is dormant, kept only until its
drop gets its own migration.
Shutdown stops APScheduler with `wait=False` — it stops future dispatches but
never drains long-running Riot work, so a deployment has a bounded shutdown
instead of waiting through provider rate-limit windows.

APScheduler opens its persistent store paused, discards stale triggers, and
rebuilds regular schedules from active `jobs.job_configurations` before it can
dispatch. Each never-run or overdue configuration is then queued exactly once
as scheduler-owned catch-up work. The scheduler resumes only after that queue
is complete, while FastAPI readiness never waits for the catch-up execution or
a Riot rate-limit window.

During a live process (not startup), an execution that claims to be running
but has no in-memory control is marked `FAILED` instead. A run that ends
without recording completion is closed `FAILED` in the run's `finally` block;
otherwise the row would stay `RUNNING` and be reported as an orphan.

## Maintenance Interlock and Lock Order

The local cleanse command (see [`database.md`](database.md)) persists
`config_json.riot_maintenance_mode` on the Match Fetcher and Player Updater
configurations — exactly one regular configuration per writer type. Regular
executions re-check the interlock after loading fresh configuration and record
`CANCELLED` before any gameplay write. Every direct Riot-data writer (account
linking, player tracking/refresh, match-history storage, matchmaking analysis)
acquires gameplay and job-table locks **in cleanup order** before its
core/auth write. Non-writing `TEST` executions are not blocked. The jobs API
cannot create or clear the interlock (`preserve_riot_writer_maintenance_mode`,
`backend/app/features/jobs/maintenance.py`); only the cleanse command's
`--resume-writers` removes it.

## Completion-Path Pitfalls (MissingGreenlet)

Never read ORM attributes of the execution or configuration during completion
handling or after the session closes — lazy loads there raise
`MissingGreenlet`. Completion paths must use the cached scalar copies that
`BaseJob` captures while the session is live
(`backend/app/features/jobs/base.py`). Likewise, the cached
`job_execution_status` is published only after the completion write persists,
so a client can never read a status the database rejected.

## Explicit Per-Player Update (`jobs.player_sync_runs`)

The authenticated Player Card update creates or attaches to the single active
run per PUUID (partial unique index) and orchestrates one targeted Match
Fetcher then one targeted Player Updater with an exact PUUID allowlist — never
expanded to all tracked players. `completed` requires both executions to
finish `SUCCESS` without recoverable warnings.

- `skipped_as_already_running` maps to `SYNC_BUSY` — only a scheduler skip
  because the same job was already active; a start that failed for database
  reasons stays `SYNC_FAILED`.
- `PuuidDecryptionError` maps to the per-player `PLAYER_ID_STALE` code: Riot
  rejected a stored PUUID issued to a different developer account. Re-search
  creates a separate row for an operator to reconcile — discovery never merges
  rows (see
  [`riot-api.md`](riot-api.md#puuids-are-bound-to-the-developer-account)).
- `_finish_sync` (`backend/app/features/jobs/player_sync.py`) never reopens a
  terminal run: startup recovery or an operator may cancel it while the
  orchestrator is mid-flight, and an unguarded write would revive the
  cancelled run and collide with its replacement; a row lock holds the check.

## Match Fetcher Invariants

- Always processes the **full product allowlist** — 420, 440, 480, 400, 450,
  2400 (`PRODUCT_SUPPORTED_QUEUE_IDS`,
  `backend/app/core/riot_api/constants.py`). Per-queue configuration must
  never return; historical `enabled_queue_ids` values are ignored and stripped
  by ordinary configuration updates so stale stored values cannot restrict
  future runs. A newly approved queue is enabled by adding it to that single
  allowlist.
- Sleeps 1.2 s between match-detail requests to respect the development-key
  100-requests/2-minutes budget, on top of the client's own
  response-reported window adaptation. Do not change throttling outside an
  explicitly scoped task (see [`riot-api.md`](riot-api.md)).
- Only current release-year matches (game version `16.*` for 2026) are
  ingested; the boundary is deliberately explicit so a new season requires a
  reviewed update instead of silently mixing historical data.
- Rank snapshots come from `update_player_league()`
  (`backend/app/features/players/service.py:1280`), Solo/Duo only, writing a
  new immutable `core.player_leagues` row only when the rank changed.

## Test Runs

Test runners run under `ExecutionType.TEST` with a **negative**
job-configuration ID as the runtime key. They must not write gameplay data —
the execution record is the only intended persistence. `suspend_regular=true`
pauses the APScheduler entry for the duration; a regular manual trigger
force-stops an active test run of the same job first.

## API Key Handling

Key lookup is database-first (newest active `core.riot_api_keys` row), falling
back to `RIOT_API_KEY` from `.env`. Job history is diagnostic only and never
decides current credential health: a new credential generation immediately
invalidates an old run's failure, and `429`s, upstream failures, and network
errors never mark a credential invalid (generation contract:
[`database.md`](database.md)). Resolve by updating the key in Settings, or
`RIOT_API_KEY` plus its non-secret `RIOT_API_KEY_VERSION` with a restart.
