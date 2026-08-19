# Guard Quality Ledger

State for [`guard-quality.md`](guard-quality.md). One row per file attacked.
Status is one of `killed` (a new test now fails against the mutation),
`accepted` (survivor left in place, reason given), `deleted` (dead code
removed), `bug` (real defect found and fixed), or `clean` (all mutations died,
guards already real).

Never re-attack a file that already has a row unless the file changed since.

| File | Attacked | Mutations | Status | Evidence / reason |
|---|---|---|---|---|
| `features/auth/utils/token-manager.ts` | 2026-08-19 | 5 | `killed` | 3 died (content-type guard, `sessionEpoch` bump, `clearAuthStateCookie` in the post-teardown 200 path). 2 survived the full 342-test suite: `namesTheEndOfTheSession` catch → `return true`, and `refreshAccessToken`'s `!isBrowser()` → `refused`. Both killed by `tests/token-manager-guards.test.ts`, each shown red against its mutation and green against real code. |
| `features/matchmaking/components/matchmaking-analysis-history.tsx` | 2026-08-19 | 6 | `killed` | The largest zero-covered file left on the frontend. Six tests in `tests/matchmaking-analysis-history.test.tsx`, all six mutations dead, each against a different one. The two worth reading: the `status === 404` branch, which is the *normal* first visit — a player who has never run an analysis — and letting it through renders that as "Analysis history could not be loaded" plus a global "Could not load this data" toast, because this query silences nothing either (the same wiring that made the Riot card's 404 non-equivalent); and `historyFigures`' `gap > 0`, which decides which of the two win rates is drawn green. The gap itself is printed through `Math.abs`, so the colour is the *only* thing on screen saying which side the gap favoured — flip the comparison and the card tells someone their team was outmatched in the game where it was the stronger one. That is why a Tailwind class is asserted here when earlier rows refused to: this one carries the finding rather than the styling. Also killed: `invalidateQueries` on `matchmaking-analysis-results` (nothing else invalidates the sibling panel, so the record just deleted stays on screen as the current result until a page reload — tested through a probe query on that key rather than by spying on the client), the failed-delete message (the row fades out on click and comes back on failure, so without it all the viewer sees is a flicker), `Math.abs` on the printed gap, and the midnight `hours ? hours : 12`. Fixtures use zone-less timestamps, which parse as local time, so the expected strings read the same on the Prague laptop and in the UTC gate. Worth noting: `formatDateTime` here is a second copy of the one in `job-execution-format.ts`, now tested twice; logged rather than merged. |
| `app/settings/email-code-inputs.tsx` | 2026-08-19 | 7 | `killed` | Zero-covered, and it is the only way a verification code gets entered. Seven tests in `tests/email-code-inputs.test.tsx`, six mutations dead on the first pass: paste stripping non-digits (people paste "Your code is 123 456" straight from the mail, and without the strip the field silently refuses it), paste replacing rather than merging (otherwise a shorter second code leaves the tail of the first behind and submits six digits that were in neither mail), the empty-paste early return, focus advancing on each digit, backspace stepping back off an empty slot, and the digits-only filter. The seventh needed a different assertion: removing `.slice(0, EMAIL_CODE_LENGTH - index)` changes nothing on screen, because the extra digits are written to array indexes past the last rendered box. It is still a real defect — `use-change-email` joins this array and refuses anything that is not exactly six characters, so a seventh entry leaves all six boxes looking correctly filled under "Enter all 6 digits" with nothing to click that fixes it. Killed by asserting the array the component emits, which is its output contract, rather than the DOM. |
| `features/smurf-boost/smurf-boost-api.ts` | 2026-08-19 | 0 | `accepted` | Flagged as an open hole twice by earlier rows, so it was worth opening — and the answer is that 0% is the correct number here. All six exports are single-expression delegations to `validatedGet`/`validatedPost`/`validatedPut`/`validatedDelete`: no branch, no fallback, no transform, nothing between the argument and the request. The only tests possible assert "this function passes this path and this schema", which restates the file line for line and would need editing every time the file is, while catching nothing the type checker does not already. Not mutated, per the 0%-coverage rule. The behaviour worth guarding is one level down in `lib/core/api` (already covered) and one level up in the components (already covered). Two things checked rather than assumed: `puuid` and `cardId` are interpolated into URLs unencoded, but both are server-issued opaque identifiers in the URL-safe alphabet, so there is no injection or escaping hole to pin. This row closes the target rather than deferring it again. |
| `app/settings/password-change-section.tsx` | 2026-08-19 | 6 | `killed` | Zero-covered credential path. Five of six mutations died against `tests/password-change-section.test.tsx`. The two refusals that never reach the server are the ones that matter: dropping the repeat-password check sends a value nobody can read back, so a mistyped new password becomes the account's password and only email recovers it; dropping the strength check spends a round trip to be told in a toast what is already printed under the field. Also killed: `CURRENT_PASSWORD_INVALID` landing on the field rather than a vanishing toast, clearing the three inputs on success, and `setShowNewPassword(false)` — two of these inputs can be switched to plain text on a settings page that stays open, so without it the new password stays legible on screen after the change. `accepted`: the `changePasswordMutation.isPending` half of the handler's early return. The button already carries `disabled` while pending and it is a `type="button"` outside any form, so a disabled button never delivers the click and the check cannot be reached — the same shape as `sign-in-form`'s `submissionInFlight` ref. The test that covers it says so rather than claiming the guard. |
| `app/settings/riot-api-settings-card.tsx` | 2026-08-19 | 5 | `killed` | Zero-covered, and it writes the credential every ingestion job authenticates with — saving activates it with no restart, which is what made an expired key a day of downtime. Five tests in `tests/riot-api-settings-card.test.tsx`. Killed: the `RGAPI-` prefix guard (the only thing between a mis-paste and the live credential, and it costs no request), the save button staying disabled after a failed test (saving a key Riot has just rejected takes ingestion down until someone notices), `setTestResult(null)` on typing (without it one rejected key leaves save disabled for every key typed after, with the reason no longer on screen), and `notifyRiotCredentialHealthUpdated()` (nothing polls for it, so other panels keep showing the old key's verdict — a red "invalid" beside a key that was just fixed). The fifth is the one worth reading: dropping the `status === 404` branch left the DOM identical, because `setting` ends up null whether the 404 is caught or thrown, so it looked like an equivalent mutant. It is not — `createProvidersQueryClient`'s global `queryCache.onError` announces any failed query, and this one sets no `silenceErrorToast`, so an env-key deployment would raise "Could not load this data" on every settings load over a card working exactly as intended. Killed by rendering against the real provider client and asserting `appToast.toast` is never called. |
| `features/jobs/components/job-executions.tsx` | 2026-08-19 | 5 | `killed` | Zero-covered. Six tests in `tests/job-executions.test.tsx`; four mutations died on the first pass and the fifth needed a better test. The one worth the iteration on its own: `data = response?.success ? response.data : initialExecutions` — this query refetches every 15 seconds behind a table someone is reading, and the fallback is what stops a single failed poll from emptying it and making a working scheduler look like one that has never run. Also killed: the `Job #<id>` fallback (executions and job configurations come from two different requests, so a row can name a job this page's list does not have), `hasMore`, and the empty state. The survivor is the one the loop exists to catch: replacing `?? null` with `?? selectedExecutionState` in the deep-link lookup passed all five original tests, because none of them had ever clicked a row, so the fallback was null either way. Killing it needed the real sequence — click a row, then let a `selectedExecutionId` arrive that resolves to nothing — where the mutation leaves the clicked execution's details on screen under a URL naming a different one. `accepted`: the `IntersectionObserver` paging path, stubbed to a no-op because jsdom intersects nothing; `loadMore`'s `!isFetching` guard is unexercised as a result and wants either a jsdom-visible observer or an e2e. |
| `features/jobs/components/job-execution-format.ts` | 2026-08-19 | 8 | `killed` | Zero-covered, and every export is what a viewer actually reads off the jobs page. 17 tests in `tests/job-execution-format.test.ts`, and eight mutations each shown red against them: the `< 60` duration boundary (60s must read `1m 0s`, not `60.0s`), `formatRecordsSummary`'s created-only branch, the `matchId` label special case (without it the generic path renders `Match Ids`), and in `formatDateTime` both the `hours ? hours : 12` fix — midnight otherwise reads `0:05 AM` — and the zero-padding that keeps `3:5:7` off the screen. The date assertions are built with `new Date(y, m, d, …)` and read back in local time, so they say the same thing on the Prague laptop and in the UTC gate container. The other three are the list-key builders: `apiCallKey` and `detailedLogKey` feed React `key` props, so two entries that differ must not collide, or React keeps the first row mounted and the second one's numbers never appear — a wrong number on screen with nothing failing. `accepted`: `formatLogDateTime`, a one-line pass-through to `formatDateTime`. Worth noting as a finding rather than a fix: `apiCallKey` omits `count`, so two calls differing only in their count collide — left alone because the surrounding fields make that combination unlikely, and changing a key builder is a behaviour change this loop did not come for. |
| `app/settings/use-change-email.ts` | 2026-08-19 | 6 | `killed` | The zero-covered class, and the biggest single unit in the frontend at 117 statements — it changes the address the account is identified by, and nothing touched it. Six tests in `tests/settings-change-email.test.tsx`, each then shown red against its own mutation: the email-format guard, `trim().toLowerCase()` normalisation (what the server stores becomes the sign-in identity, and the resend path reuses it), the `EMAIL_ALREADY_REGISTERED` mapping onto the field rather than a vanishing toast, the six-digit gate, `checkAuth()` after a successful change, and the lock that survives the dialog it closed — the brake on guessing a six-digit code. |
| `features/smurf-boost/smurf-boost-vocabulary.ts` | 2026-08-19 | 4 | `killed` | **Zero died.** Every lookup here ends in a fallback and the file says why: a result computed under a later model version must stay readable rather than failing the page. The backend can add a family or a note at any time and this frontend deploys separately, so it is a question of when. Dropping `?? family`, `?? note` or `?? ""` kept all 364 tests green — the page then renders the string "undefined" as the label on a screen about smurfing accusations. Killed by `tests/smurf-boost-vocabulary.test.ts`, which also pins the other direction: a known key must not reach its fallback, or the whole vocabulary degrades to snake_case pass-through. `accepted`: `bandColor`/`bandAccent` default cases — the visible part is the band word beside them, and asserting a Tailwind class pins styling, not behaviour. Still open: `smurf-boost-api.ts` is 0% across all six functions. |
| `features/matches/components/match-history.tsx` | 2026-08-19 | 4 | `killed` | **Zero died.** Coverage named the cause: the existing harness always answers with `matches: []`, so of this component's four states only the populated-with-zero-rows one had ever rendered. The loading card, the error card and the populated list were all unexercised. Killed: the inline error card (`if (!isFetching && error)` → `if (false)`) — this query sets `silenceErrorToast`, so that card is the only thing telling the viewer anything failed — the `retry` predicate that stops retrying a network failure, and the 64-character cap on the search box, an unbounded viewer string that ends up in a query parameter. `accepted`: the loading card (`!preferencesReady \|\| isLoading`); it needs a held-open request to observe and renders only skeletons. Still `accepted` and worth a later run: **no test renders a single match row**, because building a fixture the row component accepts is a job of its own. |
| `features/cookie-consent/utils/consent-storage.ts` | 2026-08-19 | 4 | `killed` | **Zero died**, on the module that decides whether optional storage may be used at all. Survivors: dropping `isCurrentCookieConsent` from `canUseOptionalStorage` (every stale "accept all" in the wild silently becomes consent for terms its owner never saw), accepting any `level` string from the cookie, accepting an unparseable `updatedAt`, and writing the cookie without `SameSite=Lax`. A consent cookie is visitor-writable and outlives releases, so every parser rejection branch was untested input handling. All four killed by `tests/cookie-consent-contract.test.ts`. The attribute assertions are made on the write, because jsdom hands back only `name=value` when reading `document.cookie`. |
| `lib/core/api-error.ts` | 2026-08-19 | 4 | `killed` | 2 died, and they are the two that matter most: widening `isSafeProductMessage` to `return true` (2 red) and disabling the `status >= 500` branch (2 red). 1 survived — `SAFE_CODE_PATTERN` → `/.*/`, so server prose could ride into `code`, the field callers branch on and `reportApiError` logs. The sibling guard on `message` is tested three ways; this one was tested nowhere. Killed by an `it.each` in `tests/api-error.test.ts` asserting the shape rather than one bad string. 1 `accepted` as an **equivalent mutant**: removing the `typeof data !== "object"` guard in `extractResponseError` changes no output — reading `.detail` off a string yields `undefined` and the function returns `{}` either way. |
| `lib/core/schemas.ts` | 2026-08-19 | 0 | `accepted` | Only line 578 is uncovered: the `.transform()` on `MatchmakingAnalysisStatusResponseSchema`. Its sibling `MatchmakingAnalysisResponseSchema` calls the identical `splitRunOnLifecycle` and is exercised, so a test here pins the same helper twice. Not mutated, per the 0%-coverage rule. |
| `components/ui/form.tsx` | 2026-08-19 | 4 | `killed` | **Zero died.** No test in the suite had ever rendered a validation message, so all four survived: `FormMessage` returning `null` unconditionally, `aria-invalid` pinned to `false`, the message id dropped from `aria-describedby`, and the label's error styling. One test through the only consumer kills the first three. Getting there needed a real finding: the input is `type="email"` and the form does not set `noValidate`, so native constraint validation refuses to submit anything the browser considers malformed and React Hook Form never runs — `a@b` is the shape that passes the browser and fails the app's pattern rule. `accepted`: the label's `text-destructive` class (asserting a Tailwind class pins styling, not behaviour). Two dead-code observations went to `.claude/IMPROVEMENTS.md` rather than being changed here — vendored shadcn, one consumer. |
| `components/auth-gate.tsx` | 2026-08-19 | 5 | `clean` | The negative control, and it holds: every mutation died, each against a differently-named test in `tests/auth-stranded-session.test.tsx`. `isSignedIn` dropping the hint half (3 red), the sign-in route always rendering the form, `forceRecheck` dropped from the retry, the pending state dropped from the retry surface, and `SlowProbe` showing immediately. The only uncovered line is the `useSyncExternalStore` server snapshot `() => false` (148), which jsdom never calls — `accepted`. This is what a well-guarded seam looks like: the tests were written against a real reported failure, one test per behaviour. |
| `features/auth/components/sign-in-form.tsx` | 2026-08-19 | 8 | `killed` | **Zero mutations died.** The three aimed at covered lines all survived the 349-test suite: `isFormValid` → `true`, `setIsSubmitting(false)` dropped from the `finally`, `setError(null)` dropped at submit. Coverage also showed the entire captcha escalation at 0% — `captchaRequired` was never true in any test, because the site key is unset in the test env so every case took the "not configured" branch. Three tests in `tests/sign-in-form.test.tsx` now cover the retry-after-failure path and both captcha branches; four further mutations (`setCaptchaRequired(true)`, `isCaptchaSatisfied` → `true`, dropping `captchaToken` from the login payload, and the fail-closed message) were each shown red against them. An eighth, found by the medium review after the first push, survived the completed tests: dropping `setCaptchaToken(null)` from the `CAPTCHA_INVALID` branch resubmits a token the server has already rejected, on every retry. Now killed too. `./test.sh -f` green under `compose.gate.yml` from a linked worktree. |
| `features/auth/context/auth-context.tsx` | 2026-08-19 | 4 | `killed` | 2 died (`setUser` on the first successful probe, `setIsLoading(false)` in the `finally` — 3 and 13 tests red). 1 survived: `queryClient.clear()` on the refresh-failure teardown; probing further, **all six** `clear()` calls in the file could be deleted with the suite green. Also 0%-covered and now killed: the retried-probe success branch (lines 106–108, the whole point of refreshing) and `createAuthLoginError(payload, …)` (line 215, the only place the server's own sign-in refusal enters the app). Four tests in `tests/auth-session-probe.test.tsx`, each shown red against its own mutation and green against real code; `./test.sh -f` green under `compose.gate.yml`. |

## Target list

Seeded 2026-08-19 from `frontend/coverage/coverage-summary.json`
(53.76% statements / 48.87% branches over `app`, `components`, `features`,
`lib`, `proxy.ts`). Regenerate before trusting it.

**Regenerated 2026-08-19** after the rows above: **64.72% statements / 57.70%
branches** (was 53.76 / 48.87), 414 tests. The zero-covered class is down from
19 files to 12, all of them named below — there is no unenumerated remainder
left on the frontend. `proxy.ts` reads 100% / 100% and needs no row.

### Covered — mutate these

Highest risk first. 27 files sit at ≥80% statements with ≥20 statements; the
head of that list:

1. ~~`features/auth/utils/token-manager.ts`~~ — done 2026-08-19, 2 survivors.
2. ~~`features/auth/context/auth-context.tsx`~~ — done 2026-08-19. Accepted and
   left in place: the other four `queryClient.clear()` sites (same invariant as
   the two now guarded — a per-branch spy assertion would pin the call, not the
   behaviour), the three `NODE_ENV === "development"` console warns, and the
   captcha-token append at line 182. Deleted as dead: the `typeof window`
   ternary that chose between `""` and `""`. `useAuth` outside a provider
   (line 322) is still unguarded — one 3-line test, worth folding into the next
   auth iteration.
3. `features/auth/utils/login-error.ts` — 93.8% / 86.3%.
4. ~~`features/auth/components/sign-in-form.tsx`~~ — done 2026-08-19, and the
   first target where nothing died. Accepted and left in place: `isFormValid`
   (React Hook Form's own `required` rules already refuse an empty submit, so
   the guard only changes whether the button looks disabled), the
   `ACCOUNT_LOCKED` wiring at line 80 (the message itself is unit-tested in
   `login-error.test.ts`), and the `submissionInFlight` ref, whose early return
   no test reaches — a disabled submit button already blocks implicit
   submission, so reaching it needs two submits inside one tick.
5. ~~`components/auth-gate.tsx`~~ — done 2026-08-19, `clean`, exactly as
   predicted. Worth reading before writing tests elsewhere: it is guarded
   because each test names one behaviour and was written against a failure
   that actually happened.
6. ~~`components/ui/form.tsx`~~ — done 2026-08-19. The branch gap was the whole
   error path: every one of these primitives had only ever been rendered in
   its non-error state.
7. ~~`lib/core/api-error.ts`, `lib/core/schemas.ts`~~ — done 2026-08-19. The
   pattern worth carrying forward: where a module guards two fields the same
   way, expect the tests to cover one of them and not the other.
8. ~~`features/cookie-consent/utils/consent-storage.ts`~~ — done 2026-08-19.
   Untrusted input the loop nearly walked past: the cookie is visitor-writable.
9. ~~`features/matches/components/match-history.tsx`~~ — done 2026-08-19. Left
   open: no test renders a single match row, because the harness answers every
   request with `matches: []`. A fixture the row component accepts is its own
   piece of work, and it would light up a good deal more than this file.
10. ~~`features/smurf-boost/*`~~ — done 2026-08-19, via the vocabulary rather
    than the components: the components are well covered and the fallbacks
    behind their wording were not. `smurf-boost-api.ts` remains at 0% across
    all six functions and belongs in the zero-covered list below.

`proxy.ts` is in the coverage scope; check its number when regenerating.

### Zero-covered — decide, do not mutate

19 files at 0% with ≥10 statements. Largest first:

- ~~`app/settings/use-change-email.ts`~~ — done 2026-08-19, six tests, each
  shown red against its own mutation.
- ~~`features/jobs/components/job-executions.tsx`~~ — done 2026-08-19. Left
  open: the `IntersectionObserver` paging path, which jsdom cannot trigger.
- ~~`features/matchmaking/components/matchmaking-analysis-history.tsx`~~ — done
  2026-08-19. The 404-is-a-normal-state shape shows up a second time: when a
  list endpoint answers "this player has nothing" with a 404, the branch that
  catches it is load-bearing twice over — once for the card and once for the
  global error toast.
- ~~`app/settings/riot-api-settings-card.tsx`~~ — done 2026-08-19. The lesson
  to carry: a mutation that leaves the DOM identical is not automatically
  equivalent. The global `queryCache.onError` in `components/providers.tsx`
  turns any unhandled query failure into a viewer-facing toast, so rendering
  against `createProvidersQueryClient()` rather than a bare client is what
  makes that difference observable.
- ~~`app/settings/email-code-inputs.tsx`~~ — done 2026-08-19. A survivor that
  is invisible in the DOM can still be a real defect: assert the value the
  component hands its parent, not only what renders.
- ~~`app/settings/password-change-section.tsx`~~ — done 2026-08-19. The
  redundant-guard shape shows up again: a check behind a `disabled` button
  cannot be reached, so it survives every mutation honestly.
- ~~`features/jobs/components/job-execution-format.ts`~~ — done 2026-08-19, eight
  tests. The two key builders here are read by `job-executions.tsx` above it,
  so that file is now the cheaper of the remaining jobs targets.
- `features/profile/components/recent-performance-card.tsx` — 41
- `app/settings/display-name-field.tsx` — 38
- `features/profile/components/role-stats-card.tsx` — 31

The rest, enumerated 2026-08-19 rather than left as "plus 9 more": `app/jobs/page.tsx` (30),
`features/matchmaking/components/matchmaking-analysis-results.tsx` (30),
`features/profile/components/champion-stats-card.tsx` (30),
`app/matchmaking-analysis/page.tsx` (25), `app/player-overview/page.tsx` (24),
`features/jobs/components/system-status.tsx` (20),
`features/players/components/player-card-format.ts` (16),
`components/ui/tabs.tsx` (11). The three `app/*/page.tsx` entries are route
shells; check what they actually hold before spending an iteration on one.

### Backend

Enumerated 2026-08-19, from `docker compose -f compose.gate.yml run --rm
--build -v <main-repo>/.git:<same path> -e
PYTEST_ADDOPTS="--cov-report=json:coverage-backend.json" gate -b`. That
appends a report to the `--cov` flags `test.sh` already passes and needs no
change to any config file; the JSON lands in `backend/` and is not committed.
**57.18% covered** with branch coverage on (10,214 statements, 3,880 missing,
2,102 branches) against `fail_under = 47`. The gate was green.

The frontend's two classes do not carry over, and that is the finding worth
recording before any backend iteration: **there is not one 0%-covered file in
`app`** — not a single module with ≥10 statements at zero. Every backend file
is touched by something. What the backend has instead is a third class the
card does not name: large service modules covered *thinly*, where the tested
share is the happy path and the missing lines are the error and edge branches.
Those are holes, but they are holes of a different shape, and the card's
"0% coverage is already the finding" rule gives no guidance for them.

**Mutate these** — 38 files at ≥80% with ≥20 statements. The head, with the
schema/model files set aside (they are largely declarative and Pyright already
holds their shape):

1. `app/core/riot_api/rate_limiter.py` — 128 stmts, 81.6%. The lowest-covered
   file on the mutate list, and it is the thing standing between this app and
   a Riot rate-limit ban.
2. `app/features/matches/match_lp.py` — 96 stmts, 90.2%. LP arithmetic; the
   numerics audit under [Rank Manipulation] applies here.
3. `app/features/smurf_boost_detection/statistics.py` — 59 stmts, 89.3%, and
   `composite.py` / `engine.py` / `signals.py` around it at 96–98%. This is
   the accusation engine, so a wrong number here is a wrong verdict about a
   person.
4. `app/features/matches/transformers.py` — 51 stmts, 82.2%.
5. `app/features/jobs/maintenance.py` — 40 stmts, 87.5%.
6. `app/core/validation.py` — 40 stmts, 93.5%; `app/core/database.py` — 33,
   90.9%; `app/core/riot_api/errors.py` — 32, 94.4%.

**Thinly covered — decide, do not blind-mutate.** Biggest absolute holes; a
mutation aimed at a covered line here says little, so read what is missing
first:

| File | Stmts | % | Missing |
|---|---|---|---|
| `app/features/playstyle_analysis/evaluators.py` | 396 | 8.6% | 347 |
| `app/features/matchmaking_analysis/service.py` | 532 | 34.2% | 321 |
| `app/features/auth/service.py` | 568 | 40.6% | 315 |
| `app/features/matches/service.py` | 424 | 31.7% | 282 |
| `app/features/players/service.py` | 375 | 34.6% | 228 |
| `app/features/jobs/router.py` | 271 | 17.8% | 215 |
| `app/features/jobs/base.py` | 394 | 55.6% | 160 |
| `app/core/riot_api/db_rate_limiter.py` | 223 | 23.7% | 157 |
| `app/features/jobs/scheduler.py` | 263 | 49.9% | 122 |
| `app/features/jobs/service.py` | 175 | 26.9% | 121 |

`evaluators.py` is the outlier: 396 statements at 8.6% is effectively the
zero-covered class wearing a fig leaf, and it is the largest single hole in
either half of the codebase. `auth/service.py` is the one with the most at
stake per missing line.
