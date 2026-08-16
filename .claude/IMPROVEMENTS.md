# Improvements

- 2026-08-16 backend/app/features/players/background_sync.py: run_background_match_sync overlaps near-totally with jobs/player_sync.run_player_sync (both sync one player's matches and record an execution), but with different concurrency gating — JobExecution bookkeeping vs PlayerSyncRun claiming. Consolidating them into one entry point with one gating story would delete a duplicated sync path; needs a semantic decision about which gate wins.
