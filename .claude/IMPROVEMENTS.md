# Improvements

Out-of-scope problems noticed while working on something else. One bullet per
issue, newest last:

`- <YYYY-MM-DD> <path from repo root>: one or two sentences.`

## Open

- 2026-08-24 frontend/features/smurf-boost/components/smurf-boost-detection.tsx:
  after a player update that did not finish, the card shows "Ranked solo games
  stored: N" from before the click and never re-reads it, so a rate-limited run
  that did store some games reports the old count. `fetchedGames` deliberately
  stays silent there, but the stored count itself is not part of that contract
  and is simply stale. Match History fixed its half of this in commit 485e2ca
  by refetching its own two caches on a non-completed run; the same treatment
  scoped to `playerStatsQueryOptions` would fix this one. Do not fix it inside
  `usePlayerSyncRun` — its predicate matches every query keyed by the PUUID,
  which re-reads the stored count and so breaks the two tests in
  `frontend/tests/smurf-boost-detection.test.tsx` that pin the silence:
  "quotes no fetch total while the fetch is still running" and "claims no fetch
  total when the stored count could not be re-read".
- 2026-08-25 backend/app/features/auth/service.py
  (`revoke_all_refresh_tokens_for_user`): its unlocked SELECT-then-stamp can
  race a concurrent rotation or reuse-heal commit — logout snapshots the
  active set, the rotation commits a replacement row the snapshot never saw,
  and logout answers "Successfully logged out" with that fresh token live.
  Pre-existing (plain rotation has the same window, found reviewing the
  reuse-heal branch). Fix shape: FOR UPDATE the user's active rows, or
  re-query after stamping until the set is empty.
- 2026-08-25 backend/app/features/auth/service.py
  (`resolve_user_id_for_refresh_token`): any revoked-with-replacement token
  authorises a full logout for 30 days, so a stale stolen cookie that
  /refresh would now refuse with family scope can still sign the user out of
  every device via /logout (DoS, not access). The documented intent is only
  the just-superseded holder; requiring the replacement to be unused
  (unrevoked, unreplaced) would narrow the window to exactly that case.
- 2026-08-25 frontend (admin service-status banner): "No active Riot API Key
  found! System cannot function. Please configure it in settings immediately."
  overstates the outage now that stored-data reads survive a lapsed key —
  only Riot-fetching actions fail. Soften to name what actually stops working
  (fetching new data), and drop the exclamation marks.
- 2026-08-25 backend/app/features/auth/router.py (`logout` docstring): FastAPI
  publishes a route's docstring as the OpenAPI operation `description`, and
  this one runs to ~1000 characters of internal rationale — why the route does
  not depend on an access token, what the old 401 stranded. Pre-existing, and
  narrow: the Next rewrite serves the Swagger page at `/api` but not
  `/openapi.json`, so the public page cannot load the spec. Fix shape: keep the
  one-line summary plus the caller-facing contract, and put a `\f` before the
  rest — FastAPI truncates the published description there.
- 2026-08-25 frontend: `vitest/require-mock-type-parameters` reports 233 sites
  and is off in `frontend/oxlint.config.mts`. Untyped `vi.fn()` mocks let a
  mock's arguments drift from the function it stands in for without the
  compiler noticing, which is how mock theatre survives a refactor. 233 is a
  ratchet, not a sitting; enable it per-directory as each is cleaned.
- 2026-08-25 frontend/tests: `house/meaningful-tests` reports 46 findings
  across 22 files, each named in an "off" override at the end of
  `frontend/oxlint.config.mts`. Every one is a test whose assertions are all
  mock-call checks — it pins the wiring and passes while the value returned or
  the element rendered is wrong. Five were fixed during the migration by adding
  the observable outcome (`tests/proxy-session-hint.test.ts`,
  `tests/api-validated-helpers.test.ts`), which is the shape the rest want:
  assert the rendered text, the returned `ApiResponse`, or the toast, and keep
  the call assertion beside it. Delete each name from the override as its file
  is done. Two are genuinely hard and may want a different fix:
  `tests/section-quick-navigation.test.tsx:150` asserts a *non*-subscription
  (there is no observable for "did not call `observe`"), and the
  `auth-context`/`auth-teardown` logout tests never sign anyone in, so the only
  honest observable is the rendered user state or the QueryClient cache. Do not
  silence this rule by rewriting `toHaveBeenCalledWith` into
  `mock.calls[0]?.[0]` — that is the same assertion with the detector blinded,
  and it broke typecheck when it was tried.
- 2026-08-25 frontend/lib/core/api.ts: TanStack Query hands every `queryFn` an
  `AbortSignal` and nothing here threads it — `validatedGet` and its four
  siblings take `(schema, url, params)` with no way to pass one, so a query
  abandoned by a navigation keeps its request alive to completion. The axios
  client's 30s `timeout` bounds a hang but is not cancellation. Fix shape: a
  `signal?: AbortSignal` on the five `validated*` helpers into the axios
  config, then `queryFn: ({ signal }) => …` at the call sites, then port
  stella's `require-query-signal` rule to hold it (surveyed and deliberately
  not ported for this reason).
- 2026-08-25 frontend/features/cookie-consent/utils/consent-storage.ts: two
  readers (`components/header-messages.tsx:92`,
  `features/matches/match-history-preferences.ts:41`) hand-validate JSON out of
  browser storage instead of parsing it with a zod schema, which is the pattern
  everywhere else data crosses into this app. Both are correct today. Fix
  shape: a `lib/core/stored-json.ts` doing `safeParse` and returning `null` on
  any failure, then port stella's `no-raw-stored-json` to keep new readers on
  it (surveyed and deliberately not ported for this reason).

## Findings that did not survive measurement

The findings worth not rediscovering — the ones that were wrong, or right
about the symptom and wrong about the cause. Everything else logged here has
been fixed and its detail lives in the commit that fixed it.

**Toast contrast (2026-08-22, withdrawn).** Sonner's `richColors` description
is `#00091a` on a pale tint — around 19:1. Axe was measuring the toast
mid-fade-in at `opacity: 0.0257`, which fails any threshold.
`frontend/e2e/smurf-boost-detection.spec.ts` now waits for the toast to reach
`opacity: 1` and scans it instead of excluding the toaster. Worth remembering
before trusting the next `color-contrast` finding against an animated element.

**The quick-nav panel's "longest list" (2026-08-22, cause was wrong).** The
entry claimed `h-[242px]` was sized for the longest nav list and merely looked
empty on shorter ones. Measured: the longest list any page declares is four
entries, which render about 160px — so the box was ~40% empty on *every* page,
and 242px was an arbitrary rail height rather than a fit to anything. The fix
that followed from the corrected cause was different from the one the entry
proposed: the fixed height stayed on the collapse tab, which must not move as
sections mount, and only the panel became content-sized. Three entries now
measure 132px, asserted in `frontend/e2e/smurf-boost-detection.spec.ts`.

**The `key` on the detection card (2026-08-24, cause was wrong).** The entry
claimed `key={analyzedPlayer?.puuid ?? "no-player"}` was load-bearing because
"the player search only keeps the chosen name because the card remounts".
Measured with a mount probe: the prop *is* load-bearing — without it the card
keeps the same React instance across a player switch — but not for that reason.
Deleting the key left the search box seeding correctly and every existing test
green. What it actually protects is the card's own state, and the visible
casualty is the fetch report from #217: un-keyed, "The last fetch added 12."
follows you onto the next player, who nobody fetched anything for. That is what
`frontend/e2e/smurf-boost-detection.spec.ts` now pins.

**"Neither prop is covered" (2026-08-24, half wrong).** The same entry paired
that key with `initialSearchValue` on the same page. Removing the prop failed
the pre-existing "compares a player the account has never tracked" e2e
immediately — it had been covered all along. Only the matchmaking page's copy
was genuinely untested, and it now has `frontend/tests/matchmaking-analysis-page.test.tsx`.

**"Four unmocked routes" (2026-08-24, one already fixed).** The harness entry
named `/players/{puuid}/league` and three `/matches/player/{puuid}/*-stats`
routes. Logging the catch-all and running the suite found three: `/stats` had
been mocked by #217 before the entry was read. Counting from the source rather
than from a run would have added a fourth mock nobody needed.

**The orphaned match write (2026-08-16, not a defect).** `EUN1_3990695865` was
written with no `jobs.job_executions` row covering the instant, but 2,776 of
production's 3,778 matches sit outside every execution window, and
`MatchmakingAnalysisService` calls `upsert_match` on the request path. Match
writes outside a recorded execution are the normal case here.

## Standing lesson

Measure before believing an entry in this file, including one you wrote
yourself. Five of the six above were written confidently and were wrong about
either the finding, its cause, or its size, and in every case one measurement —
the computed opacity, the rendered height, a mount probe, a logged catch-all,
one deleted prop — was enough to tell. The 2026-08-24 batch is the sharpest
example: three entries, and the fix that followed matched what the entry asked
for in exactly one of them.

The corollary is about tests, not entries. A fix that makes its own check pass
is not yet evidence: the `DEBUG` pin in `backend/tests/test_unhandled_error_response.py`
passed alone and failed in the suite, because Starlette reads that flag when
the middleware stack is built and an earlier test had already built it. Run the
whole suite before believing a fix, and mutate the line to watch the test
fail.
