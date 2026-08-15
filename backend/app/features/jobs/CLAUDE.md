# Jobs feature (app/features/jobs/)

- Jobs process the union of PUUIDs in `auth.user_tracked_players`; explicit
  Player Card updates pass an exact `target_puuids` allowlist and persist one
  active `PlayerSyncRun` per PUUID.
- A new job type also needs the SQL enum value in a reviewed Alembic revision,
  router registration, and an incremental configuration migration.
  `test_job_type_registration.py` covers the implementation half.
