# Improvements

- 2026-08-19 frontend/features/matches/components/match-row.tsx: `getDaysAgo`
  and the date printed directly above it can contradict each other. The date
  comes from `formatDate` (calendar day, local zone); the label comes from
  `Math.floor(diffMs / 86_400_000)`, which counts elapsed 24-hour blocks. A
  game played at 23:00 last night is 11 hours old at 10:00 this morning, so
  the row reads "5.8.2026 11:00 PM" with "Today" under it — on the 6th. The
  same skew makes "Yesterday" span from 24 to 48 hours back, i.e. into the day
  before yesterday. Nothing breaks, but the two lines are meant to be two
  readings of one instant and they are not. The fix is to floor both
  timestamps to local midnight before differencing; it was left alone because
  the tests would then have to pin a rule nobody has decided yet (does a game
  at 00:30 count as last night's session?). Tests in `tests/match-row.test.tsx`
  deliberately sit inside each band rather than on its edge, and say so.

- 2026-08-19 frontend/features/matchmaking/components/matchmaking-analysis-results.tsx:
  `matches_analyzed === 820 ? 910 : matches_analyzed` is a data migration
  living in a render function. The backend's basis formula used to be
  `10 + 90 * (MATCHES_FOR_WINRATE - 1)` = 820 and is now
  `10 + 90 * MATCHES_FOR_WINRATE` = 910 (`matchmaking_analysis/service.py`,
  `_build_completion_results`), so rows stored before that fix still read 820
  and are rewritten on the way to the screen. It works, but it is permanent,
  it silently rewrites any future analysis that legitimately examined 820
  matches, and it means the database and the UI disagree about the same row.
  The fix is a one-statement UPDATE over `matchmaking_analyses` rows created
  before the formula change, then deleting the ternary and its test. It is now
  commented and pinned by a test, so it is documented debt rather than a
  magic number.

- 2026-08-19 frontend/features/jobs/components/system-status.tsx: its private
  `formatRelativeTime` computes `now - date` and its first band is
  `diffMins < 1 -> "Just now"`, but the same function also renders
  `next_run_time`, which is a time in the *future*. A negative difference
  clears every band, so a run scheduled fifteen minutes out renders as
  "Next scheduled run: Just now". It is unreachable today only because
  `backend/app/features/jobs/router.py:786` hard-codes
  `next_run_time=None,  # TODO: Get from scheduler` — so whoever does that TODO
  ships the wrong label in the same change, with nothing in the gate to say so.
  The shared `lib/core/relative-time.ts` is no help: it clamps with
  `Math.max(0, ...)` and would answer "just now" too. Either that TODO comes
  with a forward-looking formatter, or the `next_run_time` block goes.

- 2026-08-19 frontend/features/players/components/player-card-format.ts:
  `formatWinRate` guesses its own units — `winRate <= 1 ? winRate * 100 :
  winRate` — because its two callers disagree. `PlayerCardWinRate` passes
  `league.win_rate` (already 0-100) and `stats.win_rate` (0-1) into the same
  function, and passes the stats value *multiplied* to the colour helpers on
  the neighbouring line. A ranked player whose win rate is between 0 and 1
  percent therefore renders as 100%. It needs about 100 ranked games with at
  most one win, so it is rare rather than impossible; the fix is to make the
  unit explicit at the call site rather than sharper in the guess.

  Wider than one function, found 2026-08-19 while testing `role-stats-card`:
  `getWinRateColor`, `getWinRateBarColor` and `formatWinRate` exist in **three**
  copies — `players/components/player-card-format.ts`,
  `profile/components/role-stats-card.tsx`,
  `profile/components/champion-stats-card.tsx` — and the same name means two
  incompatible things. The profile pair takes a fraction and multiplies by 100;
  the players copy takes a value already in percent for the colours and guesses
  for the format, and returns `"52.3"` where the other two return `"52.3%"`.
  Consolidating needs the unit decided first, so it is one change, not three.

- 2026-08-19 backend/app/features/playstyle_analysis/: the whole feature is
  1,864 lines with no consumer. Its router is mounted at
  `/api/v1/playstyle-analysis` with two endpoints, but nothing in the frontend
  calls either one — the only frontend route named `/playstyle-analysis` is a
  server-side `redirect()` to player overview, and no background job writes a
  `PlaystyleAnalysis` row (`maintenance.py` only prunes the table). The
  evidence is a grep of `frontend/` for the path, of `backend/app` for the
  service outside its own package, and of `jobs/implementations/` for the
  model. That makes `evaluators.py` (760 lines, 396 statements, 8.6% covered)
  the largest untested file in the repository *and* unreachable from the
  product. Decide whether it is a planned feature or a leftover before anyone
  spends a test campaign on it; if it is planned, a ticket, and if not, a
  deletion of the package plus its router registration and its table.

- 2026-08-19 frontend/features/matchmaking/components/matchmaking-analysis-history.tsx:
  its private `formatDateTime` is a second copy of the exported one in
  `features/jobs/components/job-execution-format.ts` — same D.M.YYYY H:MM AM/PM
  format, same midnight and zero-padding fixes, character for character. Both
  are now tested, so the same behaviour is pinned twice and a fix to one would
  silently not reach the other. Deleting the local copy and importing the
  jobs-side export is the whole change; it was left alone because moving a
  helper across features is a structural call this loop did not come for.

  Wider than two, counted 2026-08-19 while testing `match-row.tsx`: there are
  **four** hand-rolled `formatDateTime`/`formatTime` copies, and they do not
  all agree. `job-execution-format.ts` and `matchmaking-analysis-history.tsx`
  are character-identical D.M.YYYY; `matchmaking-analysis-results.tsx` writes
  the same date with **slashes** (`4/3/2026`) and `match-row.tsx` with **dots**
  (`4.3.2026`), so two screens in the same app format the same instant two
  different ways. Each carries its own copy of the `hours ? hours : 12` and
  `padStart(2, "0")` fixes, and all four are now separately tested — four
  suites pinning one behaviour. One exported helper, one format decided, three
  deletions.

- 2026-08-19 frontend/features/jobs/components/job-execution-format.ts:
  `apiCallKey` joins endpoint, region, param_key, and the first/last
  timestamp and param — but not `count`. Two API-call entries differing only
  in their count produce the same string, and it is used as a React `key`, so
  the second row would keep the first one's rendered numbers. The surrounding
  fields make that combination unlikely, which is why it was left alone;
  adding `call.count` to the join is the whole fix.

- 2026-08-19 frontend/components/ui/form.tsx: `FormControl` always points
  `aria-describedby` at `${formItemId}-form-item-description`, but
  `FormDescription` is exported and never used anywhere in the app, so that id
  never exists in the DOM. Either render a description or stop referencing one.
  The dangling half is ignored by assistive tech today, so this is tidiness,
  not a live defect.
- 2026-08-19 frontend/components/ui/form.tsx: the `if (!fieldContext) throw`
  in `useFormField` cannot fire — `FormFieldContext` is created with `{}` as
  its default, so the value is always truthy — and it sits *after*
  `getFieldState(fieldContext.name, …)` has already read through it. Vendored
  shadcn code with one consumer, so it was left alone; a guard on
  `fieldContext.name`, moved above that call, would make it mean something.
