# Jobs feature (app/features/jobs/)

- Jobs run in one of two target modes: the global union of PUUIDs in
  `auth.user_tracked_players`, or the exact `target_puuids` allowlist an
  explicit Player Card update passes. Picking the wrong one silently syncs
  every tracked player, or none. (One active `PlayerSyncRun` per PUUID needs
  no rule — `uq_player_sync_runs_active_puuid` enforces it.)
