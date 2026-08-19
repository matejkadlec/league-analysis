# Improvements

- 2026-08-19 RESOLVED same day: two entries about
  backend/app/core/riot_api/transformers.py (an unreachable per-participant
  skip handler, and four normalisation disagreements with the DTO
  transformer) are moot — the wheel-audit workflow established the whole
  raw-dict path had zero callers (`_store_match_detail` is never invoked;
  `store_match_from_dto` is the only ingestion path), and the file,
  `core/validation.py` and the dead service method were deleted outright.
  One writer remains, so there is nothing left to disagree.

- 2026-08-19 backend/app/features/auth/service.py +
  frontend/features/auth/components/join-us-form.tsx: **a message ending in
  `#nl` turns off the captcha and the hourly limit on the public contact
  form.** `/api/v1/auth/join-us/contact` is unauthenticated and sends an
  email. `_is_join_us_test_submission` matches a case-insensitive
  `endswith("#nl")` on the trimmed body, and `submit_join_us_contact_request`
  wraps *all three* protections in `if not is_test_submission`: the 300-character
  minimum, `_enforce_join_us_regular_rate_limit` (3/hour/IP), and the Turnstile
  verification. The email is still sent — `_send_join_us_contact_email` runs
  outside that branch — and `_record_join_us_submission` files the row with
  `is_test=True`, which the rate limiter then excludes from its own count, so
  test submissions never accumulate against anything.

  The only remaining brake is `@rate_limit("5/minute")` on the route, so this
  is throttled rather than unbounded: **300 uncaptcha'd emails per hour per IP
  against an intended 3**, from any client, with no bot check at all. And it is
  not obscure — `NO_LIMIT_TEST_SUFFIX = "#nl"` is a literal in a `"use client"`
  component, so the string ships to every visitor in the public JS bundle.
  Reading it is enough to use it.

  Not fixed here because the right fix is a product decision rather than a
  one-liner: gate the bypass on a non-production `ENVIRONMENT`, or on a shared
  secret that is not in the bundle, or delete it. `tests/join-us-form.test.tsx`
  deliberately pins the *protections* and not the bypass, so removing `#nl`
  from either half breaks nothing and does not read as a regression.

- 2026-08-19 frontend/features/players/context/player-context.tsx: the
  `!!urlPuuid &&` in `isLoading: authLoading || contextQuery.isLoading ||
  (!!urlPuuid && urlPlayerQuery.isLoading)` is a React Query v4 leftover and
  does nothing. In v5 `isLoading` is derived as `isPending && isFetching`, so a
  disabled query reports `isLoading: false` — measured directly, not inferred:
  a disabled `useQuery` returns `{isLoading: false, isPending: true,
  isFetching: false}`. Under v4, where `isLoading === isPending`, dropping the
  guard would have left every page permanently in its skeleton state, which is
  presumably why it was written. Removing it now is behaviour-neutral; it is
  recorded rather than done because it is the kind of "harmless" conjunct whose
  deletion looks risky without this note. Any other `x && query.isLoading` in
  the codebase is the same leftover.

- 2026-08-19 frontend/features/jobs/components/use-job-card-controls.ts: all
  **eight** `useMutation` blocks carry an `onError` handler that cannot fire.
  Every `mutationFn` is a `validatedPost`, and `validatedPost` wraps its whole
  body in `try/catch` and *resolves* with `{ success: false }` rather than
  rejecting — a contract now pinned by `tests/api-validated-helpers.test.ts`
  ("answers a failed %s rather than throwing out of the helper", all five
  verbs). So the failure is always reported by the `else` arm of `onSuccess`,
  and the ~48 lines of `onError` are dead. Verified both directions: forcing
  the mocked `validatedPost` to reject does reach the handler and does raise
  the right toast, so the code works — it is simply unreachable. Left in place
  deliberately rather than deleted: this file stops and force-stops production
  jobs, and the handlers are the difference between a toast and an unhandled
  rejection if that contract ever changes. Worth revisiting only if the
  duplication is being cleaned up anyway.

- 2026-08-19 frontend/features/jobs/components/use-job-card-controls.ts:
  `handlePauseResume` and the first eight lines of `handleMainAction` are the
  same code — the paused/test/regular resume-or-pause branch, written twice.
  `handleMainAction` could call `handlePauseResume()` for its paused case and
  lose seven lines. This is not cosmetic: the duplicate is how a mutation to
  the resume branch survived the first draft of `tests/job-card-controls.test.tsx`,
  because the test was exercising the other copy. Both copies are now covered,
  which means the next person to fix a bug in one of them has a test that
  notices they missed the other.

- 2026-08-19 frontend/features/matches/components/match-row.tsx: the row says
  whether the game was won, lost or remade **by background colour and nothing
  else** — emerald, rose, or grey, with no text, icon or label anywhere in the
  row. That is a WCAG 1.4.1 (Use of Colour) failure: a red/green colourblind
  player cannot tell a victory row from a defeat row in a list that is
  entirely victory and defeat rows, and emerald-700/30 against rose-600/30 at
  30% opacity is a small difference even with normal vision. This was found by
  deleting `getResultInfo`'s `text` field, which computed "VICTORY", "DEFEAT"
  and "REMAKE" on every render and displayed none of them — the labels the row
  needs already existed and were being thrown away. The fix is to render one
  of them (the `w-16` duration column has room beside it), not to restore the
  dead object property. Tests currently assert the tint because it is the only
  signal there is; they should assert the text once there is text.

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
  **RESOLVED 2026-08-20.** The three win-rate helper copies (players, role
  card, champion card) are one fraction-based module in `lib/core/format.ts`;
  the unit-guessing `formatWinRate` is deleted (its 0–1%-renders-as-100% bug
  with it), `league.win_rate` — the one percent-shaped source — converts at
  its call site, and the KDA color/format pair that was duplicated across
  both profile cards moved with them. The e2e league fixture was serving a
  fraction where the API serves percent, masked by the guess; fixed.

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

- 2026-08-20 frontend/features/matches/components/match-history.tsx: the
  match-list container carries `role="region"` + `tabIndex={0}` at every
  width but only scrolls at `lg:` (`lg:overflow-x-auto`), so on a phone
  keyboard users get a focus stop on a region that does not scroll. Removing
  it below `lg` needs a `matchMedia` hook for one tab stop — left alone as
  not worth the machinery; revisit if the region's classes change anyway.
