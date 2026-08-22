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

One loose end from the `queue_id = 0` investigation was chased
and closed rather than logged: `EUN1_3990695865` was written at
2026-08-16 00:16:59.942Z with no `jobs.job_executions` row covering the
instant, but 2,776 of production's 3,778 matches sit outside every execution
window, and `MatchmakingAnalysisService` calls `upsert_match` on the request
path. Match writes outside a recorded execution are the normal case here, not
a missing audit row.

The 2026-08-22 toast-contrast entry that stood here was wrong and has been
withdrawn. Sonner's `richColors` description is `#00091a` on a pale tint --
around 19:1. Axe was measuring the toast mid-fade-in at `opacity: 0.0257`,
which fails any threshold. `e2e/smurf-boost-detection.spec.ts` now waits for
the toast to reach `opacity: 1` and scans it instead of excluding the toaster.
Worth remembering before trusting the next `color-contrast` finding against an
animated element.

- 2026-08-22 frontend/features/players/use-analyzed-player.ts: every visit to
  Rank Manipulation fetches `GET /players/{puuid}` for a player the page
  already has. `usePlayerContext()` returns `current_player` in full, and the
  default analyzed player *is* that player, so the extra request only pays off
  for an explicit `?puuid=` naming somebody else. Seeding the player query
  cache from the context response, or reading the context player directly when
  `analyzedPuuid === referencePlayer.puuid`, removes it.

- 2026-08-22 frontend/components/section-quick-navigation.tsx: the expanded
  panel is a fixed `h-[242px]`, sized for the longest nav list. Rank
  Manipulation shows three entries before a comparison has run, so roughly
  half the panel is empty. Sizing to content and keeping the fixed height only
  as a `max-h` would fix it; check the rail's hover geometry first, since the
  collapse trigger sits on the same box.
