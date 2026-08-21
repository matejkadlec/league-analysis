# Improvements

Out-of-scope problems noticed while working on something else. One bullet per
issue, newest last:

`- <YYYY-MM-DD> <path from repo root>: one or two sentences.`

The OpenAPI-vs-zod digest became a gate step (`test.sh`, "API contract
alignment"); the two same-named relative-time clocks were already renamed to
`formatLastRun`/`formatNextRun` on master, and the pair is deliberately
distinct rather than duplicated.

- 2026-08-21 backend/app/features/matches/match_persistence.py: production
  Match Fetcher failed four consecutive runs (03:13-04:02 UTC) with
  `ForeignKeyViolationError` on `fk_match_timelines_puuid_players` for
  participant 3 of `EUN1_3993125759`, then succeeded at 04:28 and has not
  recurred. Not root-caused. Both timeline writers looked safe on inspection:
  `upsert_match` Core-upserts every `info.participants` player before
  `replace_match_timeline_rows` builds its rows from that same list, and
  `backfill_timeline_only_match` builds its DTO from stored `MatchParticipant`
  rows, which carry their own validated FK to `players` (checked on prod: zero
  orphans). An `IntegrityError` also escalates through `must_abort_writer_sync`,
  so one bad match kills the whole run rather than skipping the match. Next
  step is a log line naming the writer path and the participant list, since the
  container logs for the failing window were already rotated away.
