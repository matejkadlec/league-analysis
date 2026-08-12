# Jobs Feature (`app/features/jobs/`)

> **Scope:** Backend job scheduling, execution, runtime controls, and
> administrator API implementation under `backend/app/features/jobs/`.
>
> **Maintenance:** Update when a job invariant, lifecycle contract, recovery
> rule, or implementation boundary changes. File inventories and endpoint
> lists live in the code.

Inherits repository-wide rules from
[`../../../../AGENTS.md`](../../../../AGENTS.md), backend rules from
[`../../../AGENTS.md`](../../../AGENTS.md), and feature conventions from
[`../AGENTS.md`](../AGENTS.md).

[`../../../../docs/jobs.md`](../../../../docs/jobs.md) records the durable job
invariants and operational contracts; update it only when one of those
changes. Module responsibilities live in the code under this directory.

## Job and Execution Model

- Scheduled job types are `MATCH_FETCHER` and `PLAYER_UPDATER`.
- Execution types are `REGULAR` and `TEST`.
- Persisted execution lifecycle is:
  `PENDING` -> `RUNNING` <-> `PAUSED` ->
  `SUCCESS` / `FAILED` / `CANCELLED` / `RATE_LIMITED`.
- `jobs.job_configurations` owns schedules, active state, pause state, and
  `config_json`.
- `jobs.job_executions` owns per-run status, timing, metrics, errors, logs,
  key-error flag, and execution type.
- APScheduler stores its own state in `jobs.apscheduler_jobs`.

## Implementation Boundaries

- Jobs process the union of PUUIDs in `auth.user_tracked_players`.
- Explicit Player Card updates pass an exact `target_puuids` allowlist to both
  writer implementations and persist one active `PlayerSyncRun` per PUUID.
  Complete the application lifecycle only when both executions succeed without
  warnings; keep failed, cancelled, and rate-limited states honest.
- Advance `match_synced_at`, `league_synced_at`, and `profile_synced_at` only
  after the owning provider check succeeds. A clean zero-change check is fresh;
  a partial or failed check is not.
- Use a fresh database session for a job execution.
- Call `check_control_state()` at safe loop boundaries so pause and graceful
  stop remain responsive.
- Register/unregister runtime controls in all success, error, cancellation, and
  shutdown paths.
- Prevent concurrent regular runs of the same job type. Test runs use the
  negative configuration ID as their runtime key.
- A regular manual trigger may force-stop its active test run before starting.
- Match Fetcher always processes the complete central product allowlist (420,
  440, 480, 400, 450, 2400). Never reintroduce per-queue configuration.
  Historical `config_json.enabled_queue_ids` values are ignored at runtime and
  stripped from API responses/ordinary configuration updates; active state and
  scheduling remain independent job-level controls.
- Update APScheduler immediately after configuration changes through
  `sync_job_configuration()`.
- Preserve Riot API throttling and priority rules from
  [`../../../../docs/riot-api.md`](../../../../docs/riot-api.md).
- Build job clients through `BaseJob.get_job_riot_api_client()` so every direct
  provider response is tied to the effective credential generation. Job
  execution history remains diagnostic and must not decide current header
  health.
- Record recoverable execution failures through `BaseJob.record_error()` with a
  static operation name and only reviewed identifiers. It stores bounded,
  secret-safe diagnostics for administrator execution details; never pass raw
  exception text, provider payloads, or credentials as context.
- A recorded `PuuidDecryptionError` sets `has_puuid_binding_error()`, which
  `player_sync` maps to `PLAYER_ID_STALE`. It stays a per-player warning, so a
  stale row never fails an entire scheduled run.
- Never read `job_execution` or `job_config` attributes off the ORM instance
  during completion, nor after the job's session closes. A rollback expires
  them and reloading outside the async greenlet raises `MissingGreenlet`. Use
  the cached `job_execution_id`, `job_execution_started_at`,
  `job_execution_status`, `job_config_name`, and `job_config_type_value`.
  `player_sync` classifies writer outcomes from those scalars for the same
  reason.
- `run()` closes any execution that ends without recorded completion so a
  crash cannot leave the row `RUNNING` for the next tick to report as orphaned.
- Publish `job_execution_status` only once the completion write is persisted.
  A status cached from a write that never landed would contradict the stored
  row, which the fallback closes as `FAILED`.
- Only a run skipped because the same job is already active sets
  `skipped_as_already_running`, which `player_sync` maps to `SYNC_BUSY`. A run
  whose start failed also has no execution id and must stay a real failure.
- `_finish_sync` never reopens a terminal `PlayerSyncRun`. It locks the row and
  writes only while the run is still active, because an operator stop or startup
  recovery may cancel it while this orchestrator is mid-flight; reviving it
  would also risk a collision with a replacement run on the same PUUID.
- Regular Match Fetcher and Player Updater runs finish `SUCCESS` with warning
  diagnostics after isolated player, match, timeline, or provider-shape errors.
  Missing/rejected Riot credentials remain `FAILED`; rate exhaustion is
  `RATE_LIMITED`, maintenance or operator stops are `CANCELLED`, and database or
  other execution-wide failures must still escape and fail the run.
- Test runners may call the same Riot endpoints but must not write gameplay
  data; their execution record is the allowed persistence.
- The local cleanup command may set `config_json.riot_maintenance_mode` for
  regular Match Fetcher and Player Updater jobs. Preserve that interlock on
  configuration updates; only the reviewed cleanup resume path may remove it.
- Every direct Riot-data writer, including account linking, player tracking and
  refresh, match-history storage, and matchmaking analysis, acquires gameplay
  and job-table locks in cleanup order before it writes. Cleanup refuses to
  proceed unless exactly one Match Fetcher and one Player Updater configuration
  receive the interlock.
  Job-configuration updates use that same order before locking a row, and the
  jobs API cannot create the cleanup-owned interlock. Do not reintroduce a
  configuration-row-only lock.

## Startup and Recovery

- Reset persisted pause flags because pause is runtime-only.
- Mark `RUNNING`/`PAUSED` executions left by an ungraceful shutdown as
  `CANCELLED`.
- Cancel every active `jobs.player_sync_runs` row too. Its worker is
  in-process, so no row left active by a previous process can still be owned;
  the table allows one active row per PUUID and the route schedules work only
  for a newly created row, so an orphan blocks that player's updates. Startup is
  the only safe place: a live process cannot tell an abandoned row from one a
  running worker owns. Set `updated_at` explicitly, because a Core update
  bypasses the model's application-side `onupdate`. Keep the status predicate
  equal to `uq_player_sync_runs_active_puuid`'s set — a missing status strands
  rows, an extra one rewrites terminal runs.
- Never cancel `core.matchmaking_analyses` at startup. It has the opposite
  contract: `start_analysis` attaches to an active row and relaunches its
  worker, preserving completed progress across a restart, so cancelling would
  discard that progress. See
  [`../../../../docs/matchmaking-analysis.md`](../../../../docs/matchmaking-analysis.md).
- Each recovery step runs on its own session through `_run_startup_recovery()`,
  which shields the whole block around each one. Neither a step's own failure
  nor a failure while its session rolls back or closes may skip the next step,
  so every step runs before any failure is raised.
- Cancelling orphaned player syncs is *mandatory*: a failure raises
  `StartupRecoveryError`, which `_start_scheduler_safely` re-raises while still
  swallowing ordinary scheduler faults. Serving with rows stranded would look
  healthy while the route hands each orphan back with `created=False`, so no
  worker is scheduled and the client polls `pending` forever with no terminal
  status. Production runs `restart: unless-stopped`, so a transient fault gets a
  clean retry. Mark mandatory steps with the explicit flag in the step tuple,
  never by matching a function name.
- Stop APScheduler with `wait=False` during process shutdown. Deployment must
  never drain or wait for long-running Riot executions; startup recovery owns
  the interrupted persisted state.
- Detect never-run or overdue active jobs, run them at startup, and then keep
  their configured schedules.
- Service/base orphan cleanup may mark a database execution `FAILED` when no
  matching in-memory runtime control exists during a live process.

## Adding a Job

1. Add the `JobType` and SQL enum value in both models and a reviewed Alembic
   revision.
2. Implement a `BaseJob` subclass with metrics and control checkpoints.
3. Register it in the scheduler and router/test mappings as applicable.
4. Add a configuration row through an incremental migration.
5. Update `docs/jobs.md`, `docs/database.md`, and frontend controls if exposed.
6. Run backend Pyright plus any frontend checks affected by the API/UI change.
