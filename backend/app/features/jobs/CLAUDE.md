# Jobs feature (app/features/jobs/)

- Jobs process the union of PUUIDs in `auth.user_tracked_players`; explicit
  Player Card updates pass an exact `target_puuids` allowlist and persist one
  active `PlayerSyncRun` per PUUID.
- New job type: SQL enum value + reviewed Alembic revision, `BaseJob`
  subclass, scheduler/router registration, incremental configuration
  migration, then update `docs/jobs.md` and `docs/database.md`.
