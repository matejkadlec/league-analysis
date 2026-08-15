# Jobs feature (app/features/jobs/)

- Jobs process the union of PUUIDs in `auth.user_tracked_players`; explicit
  Player Card updates pass an exact `target_puuids` allowlist and persist one
  active `PlayerSyncRun` per PUUID.
- `match_synced_at` / `league_synced_at` / `profile_synced_at` advance only
  after the owning provider check succeeds — a clean zero-change check is
  fresh, a partial or failed one is not.
- New job type: SQL enum value + reviewed Alembic revision, `BaseJob`
  subclass, scheduler/router registration, incremental configuration
  migration, then update `docs/jobs.md` and `docs/database.md`.
