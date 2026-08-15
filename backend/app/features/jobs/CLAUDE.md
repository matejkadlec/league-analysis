# Jobs feature (app/features/jobs/)

- Jobs process the union of PUUIDs in `auth.user_tracked_players`; explicit
  Player Card updates pass an exact `target_puuids` allowlist and persist one
  active `PlayerSyncRun` per PUUID.
