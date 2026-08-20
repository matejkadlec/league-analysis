# Improvements

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
- 2026-08-20 backend/app/features/jobs/service.py: pause state lives on the shared JobConfiguration.is_paused DB column, which couples a test run's pause to a concurrent scheduled run of the same job (PR #127 guards one direction of the cross-talk). The root fix per the #127 review: a per-runtime-key `paused` field on RuntimeJobControl (control.py) — pause is already runtime-only in effect (scheduler resets the column on startup). Net-negative diff: deletes the commit/refresh in set_job_paused, the clear-on-stop guard, and the startup reset, and makes test-run pause genuinely independent. Wants a dedicated session: touches base.py's 1s pause poll loop and the is_paused field in JobConfigurationResponse, and deserves live verification with running jobs.
