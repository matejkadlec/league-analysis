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

- 2026-08-21 backend/app/features/matches/: production `core.matches` holds one
  row with `queue_id = 0`. **Root-caused 2026-08-21, and it is not a custom
  game.** `EUN1_3990695865` came back from Riot as an envelope with nothing in
  it: no participants, empty `gameMode`/`gameType`/`gameVersion`, `mapId` 0 and
  `gameStartTimestamp` 0, with only `gameEndTimestamp` and `platformId`
  populated. `build_match_record` copies the DTO field for field, so every zero
  was stored as fact, the row was marked `fully_analyzed`, and
  `game_start_timestamp_source` recorded `riot_game_start`. `MatchInfoDTO` now
  requires `min_length=1` on `participants`, so the next one is refused at the
  boundary and skipped per-match.

  **Left to do:** the one existing row is still in production. It has no
  participants and no timeline rows, so it renders nowhere, but it is counted
  by anything that counts `core.matches`. Deleting it is a production write and
  wants the owner's say-so; the statement is
  `DELETE FROM core.matches WHERE match_id = 'EUN1_3990695865';`

- 2026-08-21 frontend/lib/core/schemas/: `npm run deadcode` cannot see an
  unused export in these modules. `tests/api-contract-alignment.test.ts` needs
  the whole module namespace to pair schemas by name, and knip counts a
  namespace import as a use of every export -- and the `export *` barrel
  forwards that blindness to all nine modules behind it. Found by hand:
  `JoinUsContactRequestSchema` and `UserCookieConsentUpdateSchema` had no call
  site at all while knip reported zero unused exports. Both are used now, but
  the blind spot stands and covers the largest export list in the repo. A
  targeted rule in the contract test -- every exported zod schema pairs to an
  OpenAPI component -- would catch a schema that matches nothing; it would not
  have caught these two, which paired fine and were merely uncalled.

- 2026-08-21 frontend/app/page.tsx: `#header-card` is the only branded card
  without an explicit `text-white`. The old entry here bundled this with a
  `prose` hypothesis, and only that half got answered: `prose` styled nothing
  (`@tailwindcss/typography` is not installed), so it was never overriding the
  colour, and the classes are gone. What actually colours the text is the
  shadcn `Card`'s `text-card-foreground`, which f4d0bef made near-white by
  forcing `.dark` -- so the card is legible today for the same reason every
  other card is, not because it says so. The question left standing is whether
  it should say so: an explicit `text-white` there would survive a future theme
  toggle, and adding one is a visible change that wants a browser first.
