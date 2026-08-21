# Improvements

Out-of-scope problems noticed while working on something else. One bullet per
issue, newest last:

`- <YYYY-MM-DD> <path from repo root>: one or two sentences.`

The four entries that stood here on 2026-08-21 are all resolved: the
`fk_match_timelines_puuid_players` failures were root-caused to SQLAlchemy
flush ordering and are now guarded by an explicit `flush` in
`replace_match_timeline_rows`, a test, and a note in
[`pitfalls.md`](pitfalls.md); the empty `queue_id = 0` match was deleted from
production, leaving the `min_length=1` boundary refusals `9e6ed88` already
covers; `tests/schema-export-reach.test.ts` now sees the unused exports knip
cannot, matching whole file text so a Prettier-wrapped `z.infer` alias is not
mistaken for a reader; and the home page header card states its own
`text-white`, with `branded-style-contract.test.ts` holding every header card
to it.

Nothing open. One loose end from the `queue_id = 0` investigation was chased
and closed rather than logged: `EUN1_3990695865` was written at
2026-08-16 00:16:59.942Z with no `jobs.job_executions` row covering the
instant, but 2,776 of production's 3,778 matches sit outside every execution
window, and `MatchmakingAnalysisService` calls `upsert_match` on the request
path. Match writes outside a recorded execution are the normal case here, not
a missing audit row.
