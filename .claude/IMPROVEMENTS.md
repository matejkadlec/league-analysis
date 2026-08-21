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
  orphans). The blast radius is fixed and the diagnostics are in
  (`b0ec468`, `9a10fb3`): both writers' error lines now carry `writer`,
  `participants` and `timeline_rows`, `backfill_timeline_only_match` rolls back
  instead of leaving the session aborted, and `must_abort_writer_sync` no longer
  escalates a row-level violation, so the next occurrence skips the match rather
  than killing the run. The cause itself is still open -- reopen this when a
  `writer=` line for `fk_match_timelines_puuid_players` reaches the logs, which
  it could not last time because the container logs for the window had rotated.
  Ruled out since: no code path deletes a `core.players` row, so the FK's
  `ON DELETE CASCADE` is not the race; every player upsert is
  `ON CONFLICT DO UPDATE`, which takes the row lock, not `DO NOTHING`, which
  would let a concurrent rollback leave the FK unsatisfied.

- 2026-08-21 frontend/app/page.tsx: the home page's `#header-card` is the only
  one without `text-white` (`components/legal-page-shell.tsx:25` has the same
  `py-2` shape and does carry it). `globals.css` paints that id with a navy
  gradient in both themes, so the card's `prose` body may be rendering dark
  text on navy in light mode. Not verified -- it needs the app running, and
  `prose` sets its own body colour, which may or may not win. Check it in a
  browser before changing anything.

- 2026-08-21 frontend/app/globals.css: `.gold-gradient`, `.red-gradient`,
  `.blue-gradient` and the `button[type="submit"]` gradient are defined only
  under `.dark` (lines 128-172). `app/layout.tsx:69` sets
  `defaultTheme="system" enableSystem`, so a viewer whose OS is light gets no
  `.dark` class and every primary CTA, destructive action and neutral action
  falls back to the shadcn default variant -- readable, but unbranded. The
  stylesheet provides light variants elsewhere (`#header-card` has both), so
  this reads as a gap rather than a dark-only product decision. Note also that
  `tests/branded-style-contract.test.ts` claims to prevent callers "styled by
  nothing at all" but only checks that `.<name>` appears somewhere in the
  file, which a `.dark`-only definition satisfies. Picking the light-mode
  gradients is a design call, which is why this is logged rather than fixed.

- 2026-08-21 backend/app/features/matches/: production `core.matches` holds one
  row with `queue_id = 0`, which is not in `PRODUCT_SUPPORTED_QUEUE_IDS`
  (`420/440/480/400/450/2400`). Riot uses 0 for custom games. Worth finding
  which writer stored it -- the queue-sync path filters on the supported list,
  so it most likely arrived through a path that does not. The row is harmless
  (match history renders it as "Queue 0"), so this is a question about the
  writer, not a rendering fix.
