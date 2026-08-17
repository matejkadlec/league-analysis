# Matches feature (app/features/matches/)

Two declared interfaces; nothing else is public.

- `MatchService` (service.py) — the match workflows (history, stats,
  analysis, sync, reprocessing). The router and the jobs' Match Fetcher go
  through this.
- Shared domain primitives other features import directly: `models` and
  `participants` (the `Match`/`MatchParticipant` rows and lane helpers),
  `lane`, `match_lp` (LP observations, `RANKED_SOLO_QUEUE_ID`), and
  `match_persistence.upsert_match`. Readers of participants follow the
  DB-first rules in [`docs/matchmaking-analysis.md`](../../../../docs/matchmaking-analysis.md)
  (`queue_id` and `fully_analyzed` filtering).

The remaining modules (match_analysis, match_history, match_sync,
match_stats, timeline, transformers, rune_transform) are MatchService's
private decomposition — importing them from another feature couples it to
internals that reshuffle without notice.
