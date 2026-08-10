# Jobs Feature (`app/features/jobs/`)

> **Scope:** Backend job scheduling, execution, runtime controls, and
> administrator API implementation under `backend/app/features/jobs/`.
>
> **Maintenance:** Update when job types, lifecycle states, scheduler behavior,
> runtime control, API endpoints, persistence, or implementation conventions
> change.

Inherits repository-wide rules from
[`../../../../AGENTS.md`](../../../../AGENTS.md), backend rules from
[`../../../AGENTS.md`](../../../AGENTS.md), and feature conventions from
[`../AGENTS.md`](../AGENTS.md).

[`../../../../docs/jobs.md`](../../../../docs/jobs.md) is authoritative for
runtime behavior, scheduler lifecycle, API surface, and operator-facing
details. Keep it synchronized with job changes.

## Structure

| File | Responsibility |
| --- | --- |
| `base.py` | `BaseJob`, execution lifecycle, metrics, logging, and control checkpoints |
| `control.py` | In-memory running-task registry and pause/stop signals |
| `scheduler.py` | APScheduler startup, persistence, overdue runs, and schedule synchronization |
| `service.py` | Configuration/execution queries, updates, and orphan cleanup |
| `router.py` | Admin-only `/api/v1/jobs` endpoints |
| `queue_config.py` | Match Fetcher queue validation and defaults |
| `error_handling.py` | Riot error to job-signal translation |
| `log_capture.py` | Structured execution-log capture |
| `maintenance.py` | Persistent local Riot-writer maintenance interlock |
| `player_sync.py` | Persisted explicit per-PUUID Match Fetcher + Player Updater orchestration |
| `implementations/` | Match Fetcher, Player Updater, and non-writing test runners |

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
- Keep Match Fetcher queue configuration in
  `config_json.enabled_queue_ids`; validate it against the central product
  allowlist (400, 420, 440, 450), and let an empty list disable the job.
- Update APScheduler immediately after configuration changes through
  `sync_job_configuration()`.
- Preserve Riot API throttling and priority rules from
  [`../../../../docs/riot-api.md`](../../../../docs/riot-api.md).
- Record recoverable execution failures through `BaseJob.record_error()` with a
  static operation name and only reviewed identifiers. It stores bounded,
  secret-safe diagnostics for administrator execution details; never pass raw
  exception text, provider payloads, or credentials as context.
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
