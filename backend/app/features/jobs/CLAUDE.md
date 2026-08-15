# Jobs feature (app/features/jobs/)

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
- Isolated player/match/timeline/provider-shape errors finish `SUCCESS` with
  warning diagnostics. Missing/rejected Riot credentials stay `FAILED`; rate
  exhaustion is `RATE_LIMITED`; maintenance/operator stops are `CANCELLED`.
  A recorded `PuuidDecryptionError` is a per-player `PLAYER_ID_STALE` warning,
  never a run failure.
- Every direct Riot-data writer (account linking, tracking/refresh,
  match-history storage, matchmaking analysis) acquires gameplay and job-table
  locks in cleanup order before writing.
- New job type: SQL enum value + reviewed Alembic revision, `BaseJob`
  subclass, scheduler/router registration, incremental configuration
  migration, then update `docs/jobs.md` and `docs/database.md`.
