# Jobs feature (app/features/jobs/)

Scheduled job types: `MATCH_FETCHER`, `PLAYER_UPDATER`. Execution types:
`REGULAR`, `TEST`. Persisted lifecycle: `PENDING` -> `RUNNING` <-> `PAUSED` ->
`SUCCESS` / `FAILED` / `CANCELLED` / `RATE_LIMITED`. Configurations live in
`jobs.job_configurations`, executions in `jobs.job_executions`, APScheduler
state in `jobs.apscheduler_jobs`.

- Jobs process the union of PUUIDs in `auth.user_tracked_players`; explicit
  Player Card updates pass an exact `target_puuids` allowlist and persist one
  active `PlayerSyncRun` per PUUID.
- `match_synced_at` / `league_synced_at` / `profile_synced_at` advance only
  after the owning provider check succeeds — a clean zero-change check is
  fresh, a partial or failed one is not.
- Fresh database session per execution; `check_control_state()` at safe loop
  boundaries (pause/stop stay responsive); no concurrent regular runs of the
  same job type; test runs key on the negative configuration ID and never
  write gameplay data.
- Match Fetcher always processes the complete queue allowlist — never
  reintroduce per-queue configuration; historical `enabled_queue_ids` values
  are ignored and stripped. `sync_job_configuration()` updates APScheduler
  immediately after configuration changes.
- Isolated player/match/timeline/provider-shape errors finish `SUCCESS` with
  warning diagnostics. Missing/rejected Riot credentials stay `FAILED`; rate
  exhaustion is `RATE_LIMITED`; maintenance/operator stops are `CANCELLED`.
  A recorded `PuuidDecryptionError` is a per-player `PLAYER_ID_STALE` warning,
  never a run failure.
- Cleanup interlock (`config_json.riot_maintenance_mode`) may only be set by
  the reviewed local cleanup command; preserve it on configuration updates.
  Every direct Riot-data writer (account linking, tracking/refresh,
  match-history storage, matchmaking analysis) acquires gameplay and job-table
  locks in cleanup order before writing; cleanup refuses unless exactly one
  configuration per writer type carries the interlock.
- Startup recovery: reset pause flags (runtime-only), mark orphaned
  `RUNNING`/`PAUSED` executions `CANCELLED`, and cancel active
  `player_sync_runs` (mandatory — an orphan blocks that player's updates
  forever). Never cancel `core.matchmaking_analyses` at startup: it attaches
  to active rows and resumes completed progress across a restart.
- Scheduler shuts down with `wait=False` — deployments never drain long Riot
  executions; startup recovery owns the interrupted persisted state. Start
  paused, rebuild schedules from active configurations, queue overdue
  catch-up work once, then resume without blocking readiness.
- New job type: SQL enum value + reviewed Alembic revision, `BaseJob`
  subclass, scheduler/router registration, incremental configuration
  migration, then update `docs/jobs.md` and `docs/database.md`.
