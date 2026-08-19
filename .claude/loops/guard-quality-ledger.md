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
| `backend: app/features/smurf_boost_detection/statistics.py` | 2026-08-19 | 7 | `killed` | 89% → 97%. Every estimator here is spelled out rather than delegated, because the module docstring says library defaults disagree on exactly these choices — and the mutation sweep found the two the suite was not holding. **`sample_variance` using `n` instead of `n - 1` survived the whole 620-test suite**, as did **`hedges_g` without its small-sample correction**, which is the only thing separating Hedges' g from Cohen's d. Neither changes a shape or a type: the composite keeps standardizing, the function keeps returning a float, and every calibrated threshold in the accusation model quietly means something else. On the eight-game windows this model actually sees, the variance denominators differ by 14% and the correction by 13% — the width of a band, which is a stronger accusation about a person than the evidence supports. Both denominators appear within twenty lines of each other, which is what makes the edit small. Also killed: `population_variance` in the other direction, and the three degenerate-input guards (a single recent game, a player with no games at all, and a Hedges window of two), each of which is a real input rather than a defensive flourish. `accepted`, with a proof rather than a shrug: the `abs(denominator) <= EPSILON` guard on line 106 is **unreachable**. The denominator simplifies to `(n^2 - 1) * k / ((n - 2)(n - 3))` where `k = m4 / m2^2`, and `k >= 1` for any real sample by Cauchy-Schwarz, so it is bounded away from zero whenever `m2 > EPSILON` — which the line above already ensures. Checked empirically too: over 400,000 samples shaped as uniform, two-valued, single-spike, near-zero and near-1e9, the smallest magnitude seen was 1.59, nine orders of magnitude above `EPSILON`. Left in place rather than deleted, because this module is under a numerics audit and an unreachable guard costs nothing. |
| `backend: app/features/playstyle_analysis/evaluators.py` | 2026-08-19 | 0 | `accepted` | The largest hole in the repository — 760 lines, 396 statements, 8.6% covered — and **not mutated, because coverage is not the finding here**. Before writing a test campaign the loop checked who calls it, and the answer is nobody. The router is mounted at `/api/v1/playstyle-analysis` with two endpoints; no frontend code calls either, and the only frontend route with that name is a server-side `redirect()` to player overview. No background job writes a `PlaystyleAnalysis` row — `jobs/maintenance.py` names the table only to prune it. Verified three ways: a grep of `frontend/` for the path, of `backend/app` for the service outside its own package, and of `jobs/implementations/` for the model. Testing 1,864 lines of unreachable feature would be the most expensive way this loop could produce nothing, so the finding went to `.claude/IMPROVEMENTS.md` as a decision for the owner — planned feature and therefore a ticket, or leftover and therefore a deletion. Re-open this row if it acquires a caller. |
| `features/players/components/player-card-format.ts` | 2026-08-19 | 7 | `killed` | Zero-covered, twelve tests, seven mutations dead. The one worth the row is `formatDate`'s `timeZone: "UTC"`, because **dropping it is invisible in the gate**: the container runs UTC, the ambient zone and the requested one agree, and no assertion can see the difference — it would pass CI and show the wrong day on every machine anyone actually uses. The test file sets `process.env.TZ = "Pacific/Kiritimati"` at module scope, before anything reads `Intl`, and this was verified to take effect under Vitest rather than assumed; a second assertion checks the ambient zone is not UTC, so the guard cannot quietly stop guarding. The fixture is half an hour before midnight UTC, which is where a zone offset changes the *day*. This is the frontend twin of the `TZ=Pacific/Kiritimati` fixture used for `match_lp.py`, and the shape to copy for any date test here. Also killed: both win-rate thresholds in both helpers — the figure and the bar beneath it read the same number through two separate functions, so a threshold that drifts between them shows a green number over a red bar — the trailing-zero trim, the `Never` guard (`new Date(null)` is the epoch, so without it a never-synced player is reported as last updated on 1 January 1970), and the fraction/percentage reconciliation. That last one is also a finding: `formatWinRate` *guesses* its units because its two callers disagree, and the same component passes the stats value multiplied for the colour and unmultiplied for the text. A ranked player between 0 and 1 percent renders as 100%. It needs ~100 ranked games with at most one win, so it went to `.claude/IMPROVEMENTS.md` rather than being changed here. |
| `backend: app/features/matches/match_lp.py` | 2026-08-19 | 7 | `killed` | 90% → **100%**, and every uncovered line was a refusal. Seven mutations, seven dead, in `tests/test_match_lp.py`. This module decides the LP number shown beside a match, so its failure mode is a *wrong* number, not a missing one. Killed: `_result_direction_matches` (counters can transition by exactly one while the LP moved the other way — a decay, a promotion adjustment, or a pair that quietly spans more than this match — and accepting it puts a negative LP change on a victory); the `before < match_end < after` bracket, which is what makes the attribution a proof rather than a guess; `missing_after_snapshot` collapsing into `missing_before_snapshot`, losing the distinction between a refusal the next league sync recovers and one it does not; and the remake initialization, without which a remake stays "pending" and a later observation can land a real LP change from a different game on a match that moved nobody's rank. Two are worth carrying forward. **A survivor the existing suite could not have found:** `_counter_transition_matches` requires the *other* counter to have stayed still, and dropping that half survived the first pass — `progression_match_count` counts only the batch being persisted, not the games played between the two snapshots, so an hour of play can put a win and a loss in one window and the mutant credits one match with both games' LP. Now killed by its own test. **And a gate-divergence guard:** `league_snapshot_datetime` reads a naive timestamp as UTC rather than local, and the mutation to `astimezone` is invisible in a UTC container. The test forces `TZ=Pacific/Kiritimati` (UTC+14) through a fixture that restores the real zone, so the mutation dies *inside* the gate as well as on the Prague host — the shape any future timestamp test here should copy. |
| `backend: app/core/riot_api/rate_limiter.py` | 2026-08-19 | 6 | `killed` | **First backend iteration.** 82% statements, and the 18% was the part that waits — lines 128–141 and 162, the saturation sleep and the burst spacing, were the only thing this class exists to do and nothing reached them. Six tests appended to `tests/test_riot_api_boundaries.py`, six mutations dead, one named test each; coverage 82% → 96%. The two that matter most are the sleeps: without them the client sends into a window Riot has already filled, and a persistent offender is escalated from 429s to a key ban, which on this deployment stops ingestion completely because there is one key. Also killed: `used < current.used` in `_record_window` — a count that dropped is the *only* signal that a provider window rolled over, since Riot never says when one started, so anchoring to the old start makes the limiter believe capacity returns sooner than it does and resume sending into a window that is still filling; `_discard_expired` actually deleting rather than skipping (the match fetcher holds one limiter for hours across many scopes, so a skipped window stays in the dict for the life of the process); `by-riot-id` redacting **two** segments, because a Riot ID is `gameName/tagLine` and redacting fewer gives every player searched for its own method window, where each looks unused and the shared budget is never observed; and the broad `except` in `update_limits`, which runs on the success path of every response — the limiter is advisory, and losing it must not lose data that already arrived. `accepted`: three defensive lines still uncovered (130, 177, 229) — a non-positive wait, an unparseable header pair, and a limit with no matching count. Each is a guard against provider output the parser upstream already rejects. Harness note for later backend rows: `docker compose -f compose.gate.yml up -d postgres` plus one long-lived container (`run --rm -d --entrypoint sleep … infinity`) gives 0.3s scoped `pytest` runs, against minutes for `gate -b`; the full gate still runs once at commit time. |
| `features/profile/components/recent-performance-card.tsx` | 2026-08-19 | 6 | `killed` | Zero-covered, and the whole card is a verdict about whether someone is getting better. Six tests in `tests/recent-performance-card.test.tsx`. The mutation that matters most is one word: `getTrendIndicatorRaw(recent.avg_deaths, overall.avg_deaths, false)` is the only call passing `false`, because deaths are the one stat where down is good. Flip it and a player who has halved their deaths is told they are **declining** — not a missing verdict but a backwards one, on the page they open to find out. Also killed: the `limit: 10` on the recent query (it is the only thing distinguishing the two requests, so without it both fetch the same numbers, every stat reads "stable" forever and nothing on screen looks broken), both significance bands (`0.05` absolute for the win rate, `overall * 0.05` for the raw stats — a fixed number cannot serve both a fraction and a count in the hundreds, and with no band at all one of "improving"/"declining" is always on screen and neither means anything), and the `total_matches === 0` guard, without which an empty ranked history renders as a full card of zeros under a badge announcing a comparison with 0 games. The sixth survivor was resolved by `deleted` rather than a test: `higherIsBetter: boolean = true` has a default no call site uses, and it is the convenient default that would silently get the one `false` call wrong. The parameter is now required, so each call says which direction it means. |
| `app/settings/display-name-field.tsx` | 2026-08-19 | 8 | `deleted` | Zero-covered. Ten tests in `tests/display-name-field.test.tsx`; seven mutations killed and the eighth resolved by deleting the code it was aimed at. The deletion is the finding: `handleSaveDisplayName` ran **two** character checks in sequence, and the second one — `/^[\p{L}\p{M}_ ]+$/u`, with its own toast and its own wording — can never fire. The first pattern anchors a letter at each end with a run of letters, marks, underscores and spaces between them, so every character class inside it is a subset of the second's, so anything reaching line two has already been proven to match it. Verified rather than eyeballed, two ways: no code point in the whole Unicode range is accepted by a first-pattern class and rejected by the second, and 400,000 random strings over an alphabet of letters, marks, digits, punctuation, an astral letter and an emoji produced no counterexample. The `pitfall-check` agent then re-derived the same result independently, and added that the deleted block ran *second*, so its toast was unreachable in `master` too — no message disappeared with it. Killed: the `trim` on what is sent (the server stores the string it is given, so an untrimmed paste renames the account to something that reads with a gap in front of it), the minimum length, the pattern itself in both directions — widened to `.+` *and* narrowed to `[a-zA-Z]`, because a rule written with `\p{L}` that nobody tests would quietly become "English only" on a deployment whose only region is `eun1` — `void checkAuth()` after a successful rename (the header and sidebar read the name off the auth session, not off this mutation, so without it every other surface keeps the old name until a reload), and the failure toast. The `!trimmed` guard needed a second pass: it survived at first because a blank name is refused anyway by the length check below it. Its only effect is *which* message appears, so the test now asserts the message — "Enter a display name" rather than "Use at least 3 characters" answered to someone who typed nothing. |
| `features/matchmaking/components/matchmaking-analysis-history.tsx` | 2026-08-19 | 6 | `killed` | The largest zero-covered file left on the frontend. Six tests in `tests/matchmaking-analysis-history.test.tsx`, all six mutations dead, each against a different one. The two worth reading: the `status === 404` branch, which is the *normal* first visit — a player who has never run an analysis — and letting it through renders that as "Analysis history could not be loaded" plus a global "Could not load this data" toast, because this query silences nothing either (the same wiring that made the Riot card's 404 non-equivalent); and `historyFigures`' `gap > 0`, which decides which of the two win rates is drawn green. The gap itself is printed through `Math.abs`, so the colour is the *only* thing on screen saying which side the gap favoured — flip the comparison and the card tells someone their team was outmatched in the game where it was the stronger one. That is why a Tailwind class is asserted here when earlier rows refused to: this one carries the finding rather than the styling. Also killed: `invalidateQueries` on `matchmaking-analysis-results` (nothing else invalidates the sibling panel, so the record just deleted stays on screen as the current result until a page reload — tested through a probe query on that key rather than by spying on the client), the failed-delete message (the row fades out on click and comes back on failure, so without it all the viewer sees is a flicker), `Math.abs` on the printed gap, and the midnight `hours ? hours : 12`. Fixtures use zone-less timestamps, which parse as local time, so the expected strings read the same on the Prague laptop and in the UTC gate. Worth noting: `formatDateTime` here is a second copy of the one in `job-execution-format.ts`, now tested twice; logged rather than merged. |
| `features/auth/utils/login-error.ts` | 2026-08-19 | 5 | `killed` | Target 3 on the covered list, and the last one left unfinished — it had been claimed by a peer session that never opened a branch or a PR for it, so it was reclaimed rather than left dangling. 95.8% statements hid three untested messages, all of them the ones a person can act on. Killed: the `ACCOUNT_LOCKED` branch that names a time (the existing test only passed an unparseable `locked_until`, so the branch that formats a real one had never run — without it a lockout says "please try again later" and leaves someone guessing between a minute and the rest of the day, which is the whole reason the server sends the timestamp); `CAPTCHA_INVALID`, reachable on any retry after a failed check and otherwise a dead-end "Something went wrong"; and `status === 429`. The lockout assertion matches the *shape* of the message rather than the formatted time, because `toLocaleString()` reads differently under the gate's `LANG=C` and UTC than on the Prague laptop. Folded in from target 2: `useAuth` outside an `AuthProvider` (auth-context line 322), now one test in `tests/auth-session-probe.test.tsx` — without the guard the context is `undefined` and the failure surfaces as a destructure error pointing at the caller instead of at the missing provider. `accepted` as an **equivalent mutant**: `getLoginErrorDetail`'s `typeof detail === "object"` guard. Checked rather than assumed — `detail` only ever arrives from a JSON body, and no non-object JSON value carries a `.code` or `.locked_until` property, so dropping the guard produces the identical error either way. |
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

Highest risk first. **31** files sit at ≥80% statements with ≥20 statements
(recounted 2026-08-19 from the regenerated summary). The head, worked in order:

1. ~~`features/auth/utils/token-manager.ts`~~ — done 2026-08-19, 2 survivors.
2. ~~`features/auth/context/auth-context.tsx`~~ — done 2026-08-19. Accepted and
   left in place: the other four `queryClient.clear()` sites (same invariant as
   the two now guarded — a per-branch spy assertion would pin the call, not the
   behaviour), the three `NODE_ENV === "development"` console warns, and the
   captcha-token append at line 182. Deleted as dead: the `typeof window`
   ternary that chose between `""` and `""`. `useAuth` outside a provider
   (line 322) was folded into the `login-error.ts` iteration and is now tested.
3. ~~`features/auth/utils/login-error.ts`~~ — done 2026-08-19, reclaimed from a
   peer session that had claimed it and never opened a branch. A file at 95.8%
   still had three of its user-facing messages untested; high coverage on a
   `switch` says the switch ran, not that every arm did.
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

The tail, named rather than counted — the 14 of those 31 no iteration has
touched, largest first:
`features/matchmaking/components/matchmaking-analysis-session.tsx` (85, br 88),
`features/matches/match-history-preferences.ts` (36),
`features/matches/queue-catalog.ts` (31),
`features/players/components/track-player-button.tsx` (30),
`features/players/utils/riot-id.ts` (27),
`lib/core/relative-time.ts` (27, br 72),
`components/ui/select.tsx` (25), `components/ui/table.tsx` (24),
`components/ui/dialog.tsx` (23),
`features/auth/utils/auth-state-cookie.ts` (23, br 67),
`lib/core/hooks.ts` (23, br 80),
`components/toast-host.tsx` (20, br 71),
`lib/core/data-dragon-version.ts` (20, br 88).
Branch percentage is the better sort key here than statements: the three
lowest — `auth-state-cookie.ts`, `toast-host.tsx`, `relative-time.ts` — are all
small files whose *statements* are near-fully run, which is the shape that hid
three untested messages in `login-error.ts`.

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
- ~~`features/profile/components/recent-performance-card.tsx`~~ — done
  2026-08-19. A boolean argument that reverses a verdict is worth finding
  everywhere: one call site in seven wanted the opposite value, and a default
  on that parameter would have been the convenient way to get it wrong.
- ~~`app/settings/display-name-field.tsx`~~ — done 2026-08-19, and the first
  `deleted` row in the ledger. Two validation checks in a row where the second
  is a strict superset of the first: worth looking for wherever a guard was
  added defensively beside one that already covered it.
- ~~the three `app/*/page.tsx` entries~~ — done 2026-08-19, resolved as one
  row because the finding was not in any of them individually. They are not
  route shells: each is ~200 lines of query wiring. But the only guard in them
  whose loss is silent is the `<ProtectedRoute>` wrapper, and it was untested
  on **six** pages — `/`, `/player-overview`, `/match-history`,
  `/matchmaking-analysis`, `/settings`, `/smurf-boost-detection`. Deleting it
  from any one of them typechecked, linted, and passed all 451 tests; what
  ships is a page that renders its own chrome to a signed-out visitor and fills
  it with 401s. `tests/page-navigation-contract.test.ts` already pinned
  `requireAdmin` on `/jobs` and nothing else, so the flag on the one admin page
  was guarded while the wrapper on the other six was not. The new test is
  written fail-closed — a page is required to be wrapped unless its route is
  named in `PUBLIC_ROUTES` or its file calls `redirect(`, so a new page is
  protected by default and making one public is a deliberate edit. Verified
  red against the mutation on all seven pages, one at a time.

  **Accepted, with the reason worth keeping:** `handleRefreshAll` in
  `player-overview/page.tsx` invalidates seven query keys, and a deleted line
  leaves one card stale after a refresh. It was checked rather than assumed:
  every one of the seven maps to a live query in the rendered subtree, nothing
  the page renders is missing from it, and the one key the subtree uses that is
  *absent* — `tracking-status`, via `TrackPlayerButton` inside `PlayerCard` —
  is absent correctly, because whether you follow a player does not change when
  their Riot data does. A killing test needs five separate fetch mocks and the
  failure it would catch self-corrects on the next mount.

  The remaining plumbing in all three — skeleton-vs-content ternaries, the
  `isLoading` three-way, the per-card `null` fallbacks — is accepted as render
  shape. A mutation there changes which placeholder is on screen for one frame.
- **Coverage floors ratcheted 2026-08-19**, in the same iteration, because
  they had fallen 18 points behind (51/46/48/52 against a measured
  69.19/61.14/63.68/69.66) and every test this loop added could have been
  deleted with the gate silent — which is the exact failure the comment above
  those floors was written about, repeated by the campaign that wrote it.
  Verified the new floors bite by raising one to 99 and watching the run exit
  non-zero. The coverage `include` was also extension-qualified: a bare
  `components/**` was handing `CLAUDE.md` and `AGENTS.md` to the parser and
  printing a RolldownError stack for each, which is how the same message about
  a *real* file would get ignored.
- **The `process.env.TZ` trick is safe to copy** — settled by `pitfall-check`
  rather than assumed, since an earlier row recommended it. Vitest 4's default
  `pool: "forks"` with `isolate: true` gives every test file its own process
  (distinct PIDs, confirmed on a probe, and still distinct under
  `--maxWorkers=1`); nothing in `package.json`, `test.sh` or the config
  overrides it. Under `--no-isolate` it does leak, and `unstubEnvs: true` does
  not help — it restores `vi.stubEnv`, not a raw assignment. The one wrong
  claim in that file's header, that the zone is set "before anything reads
  `Intl`", has been corrected in place: ESM hoists the imports above it, and
  the trick works only because `formatDate` builds its formatter per call.
- ~~`features/profile/components/role-stats-card.tsx`~~ — done 2026-08-19,
  six tests, nine mutations, and the first row where the loop's own test was
  the thing that failed the discipline.

  The guard worth having is **cross-language**. Two maps face each other
  across the API with neither naming the other: the backend turns Riot's
  `UTILITY` into `Support` (`matches/match_stats.py`), and this card turns
  `Support` back into `position-utility.svg`. The card's lookup ends in
  `|| "/positions/position-middle.svg"`, so renaming a lane on *either* side
  does not fail — it silently draws the mid icon on every support row, under
  alt text that still reads "Support". The test reads `LANE_DISPLAY_NAMES` out
  of the Python source and asserts the five names render five *distinct*
  icons; distinctness is the only workable assertion, because "not the
  fallback" cannot be checked when Mid's own icon is the fallback. Verified
  red against a rename on the frontend side and against a rename on the
  backend side.

  Also worth copying: `next/image` renders a broken image rather than failing
  the build, and nothing else in the gate opens `public/`, so a renamed asset
  ships. One `existsSync` per icon closes that.

  **The survivor was in the test, not the source.** Dropping the
  `totalGames > 0` guard makes the play-rate bar `width: NaN%`, and the first
  version of the test looped over `container.querySelectorAll("[style*=width]")`
  asserting each was `"0%"`. It passed against the mutation: React drops the
  invalid declaration, the attribute disappears, the selector matches nothing,
  and a loop over nothing asserts nothing. **Any test that reads the DOM by a
  selector has to pin how many elements it found** — this is the second time a
  vacuous assertion has appeared in this campaign, and the first time the
  mutation caught it.

  Logged rather than fixed: `getWinRateColor` / `getWinRateBarColor` /
  `formatWinRate` exist in three copies, and the same name means a fraction in
  two of them and a percent in the third.
- ~~`features/profile/components/champion-stats-card.tsx`~~ — done
  2026-08-19, six tests, nine mutations. **Two survived, and both were the
  test's fault rather than an equivalent mutant.** One iteration after the
  same thing on `role-stats-card`, which makes it the pattern of this stretch
  and the reason to keep mutating even when the tests look thorough.

  The first: the headline test claimed that reading `paginationState.page`
  instead of `pageForChampionDataSource(...)` strands someone on an empty
  card. It does not — `getChampionPage` clamps an out-of-range page back into
  range, so the empty card is already impossible and the test passed against
  the mutation. The guard is real but the failure is different: page to
  champions 11–12 of one player, open a player with twenty champions, and you
  land on their eleventh-best. The second list has to be **longer** than the
  page reached in the first for the difference to exist at all. **A test whose
  stated failure mode is wrong passes for the wrong reason** — the mutation is
  what tells you, and the comment had to be rewritten, not just the fixture.

  The second: the KDA fixture held 3, 2 and 1.99, so moving the green
  threshold from 3 to 2.5 recoloured nothing it looked at. Every band needs a
  value *just under* its threshold as well as one on it, or the test pins only
  that three bands exist.

  Died cleanly: the rank number restarting per page (the second page opens
  with another "1", reading as the best champion twice), both ends of the
  pager, and both off-by-ones available in the "1–5 of 12" label.
- ~~`features/jobs/components/system-status.tsx`~~ — done 2026-08-19, nine
  tests, twelve mutations, all died. The file is worth reading for the two
  things the mutations did *not* find, both of which came out of reading it.

  **A live trap, logged rather than fixed.** The private `formatRelativeTime`
  computes `now - date`, and its first band is `diffMins < 1 -> "Just now"`.
  The same function also renders `next_run_time`, which is a time in the
  future: a negative difference clears every band, so a run fifteen minutes
  out reads "Next scheduled run: Just now". It is unreachable only because
  `jobs/router.py:786` hard-codes `next_run_time=None,  # TODO: Get from
  scheduler`. Whoever does that TODO ships the wrong label in the same change.
  A test cannot be written for it without first pinning behaviour nobody has
  decided on, so it is in `IMPROVEMENTS.md` with the line number.

  **Accepted as unreachable, and kept.** The health headline ends in
  `: "Check Required"`, and no value the backend can produce reaches it:
  arriving there needs `!isHealthy`, `running_executions <= 0`, and
  `scheduler_running`, which contradicts `isHealthy`'s own definition unless
  the count is negative or `NaN`. `z.number()` admits both; a `len()` on the
  server produces neither. Unlike the two validation patterns deleted from
  `display-name-field.tsx`, this arm is the *last* branch of a cascade over
  untrusted numbers, so what it guards against is rendering nothing at all.
  Kept, and now recorded as deliberate rather than as an untested branch.

  The four relative-time bands are the reason the mutation count is high:
  `45m ago` and `45h ago` are both plausible readings of a jobs page, and a
  boundary that slips by a factor of sixty is invisible in review.

The rest, enumerated 2026-08-19 rather than left as "plus 9 more": `app/jobs/page.tsx` (30),
`features/matchmaking/components/matchmaking-analysis-results.tsx` (30),
~~`features/profile/components/champion-stats-card.tsx`~~ (30, done 2026-08-19 —
six tests, nine mutations, **two survivors and both of them the test's
fault**, one iteration after the same thing happened on `role-stats-card`;
see the paired row below),
`app/matchmaking-analysis/page.tsx` (25), `app/player-overview/page.tsx` (24),
~~`features/jobs/components/system-status.tsx`~~ (20, done 2026-08-19 — nine
tests, twelve mutations, all died; the row below carries the two findings),
~~`features/players/components/player-card-format.ts`~~ (16, done 2026-08-19),
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

**Mutate these** — 38 files at ≥80% with ≥20 statements.

**Accepted as a class, 2026-08-19: the 8 purely declarative files.** Not
"schemas and models" as a name — that name is wrong, and checking it is what
produced this row. Filtering the 38 by *no function bodies and no validators*
leaves exactly eight, all at 100%: `matches/participants_schemas.py` (80),
`jobs/schemas.py` (67), `smurf_boost_detection/schemas.py` (60),
`smurf_boost_detection/config.py` (43), `players/schemas.py` (41),
`core/models.py` (32), `playstyle_analysis/models.py` (26),
`players/leagues_schemas.py` (24). These declare field names and types and
nothing else; Pyright holds their shape and a mutation to a type annotation is
a type error, not a surviving mutant. The other schema files are **not** in
this class and stay on the list — `settings/schemas.py` carries 14 validators,
`auth/schemas.py` 6, `matchmaking_analysis/schemas.py` 6. A validator is
executable input validation at a trust boundary, which is the opposite of
declarative.

That leaves 30 with logic. The head, worked in order:

1. ~~`app/core/riot_api/rate_limiter.py`~~ — done 2026-08-19, 82% → 96%. The
   lesson for the rest of the backend list: on a file this size, the covered
   percentage said nothing about *which* part was covered. The bookkeeping was
   tested and the waiting was not, and waiting is the whole class.
2. ~~`app/features/matches/match_lp.py`~~ — done 2026-08-19, 90% → 100%. Every
   uncovered line was a refusal branch, which is the pattern to expect on the
   rest of this list: the happy path is what gets tested, and the guards that
   stop a wrong number reaching the screen are what do not.
3. ~~`app/features/smurf_boost_detection/statistics.py`~~ — done 2026-08-19,
   89% → 97%, and the row worth reading before picking another numerics
   target: two mutations survived the entire 620-test suite, both of them a
   one-token change to a denominator. `composite.py` / `engine.py` /
   `signals.py` around it are still at 96–98% and unattacked.
4. `app/features/matches/transformers.py` — 51 stmts, 82.2%.
5. `app/features/jobs/maintenance.py` — 40 stmts, 87.5%.
6. `app/core/validation.py` — 40 stmts, 93.5%; `app/core/database.py` — 33,
   90.9%; `app/core/riot_api/errors.py` — 32, 94.4%.

The tail, named rather than counted — the remaining 21 of those 30, sorted by
what is at stake rather than by size:

*Validators (executable rules on untrusted input):*
`app/features/matchmaking_analysis/schemas.py` (52, **80.4%** — the
lowest-covered file on the whole list, and six validators),
`app/features/auth/schemas.py` (74, 90.9%, six validators),
`app/features/settings/schemas.py` (229, 97.6%, **fourteen** validators —
biggest file in the covered half of the backend).

*Numerics, all unattacked and all neighbours of the file where two mutants
survived 620 tests:* `smurf_boost_detection/signals.py` (159, 96.8%),
`engine.py` (107, 96.9%), `composite.py` (95, 98.2%).

*Riot-API surface:* `core/riot_api/models.py` (261, 95.1% — four validators,
so not declarative despite the name), `core/riot_api/constants.py` (95, 95.1%),
`features/matches/schemas.py` (176, 98.9%),
`features/matches/participants.py` (119, 98.3%).

*Auth plumbing:* `auth/cookies.py` (22, 100%),
`auth/user_cookie_consent.py` (26), `auth/refresh_token.py` (24),
`auth/email_change_request.py` (22), `auth/revoked_access_token.py` (20),
`auth/models.py` (35). The last five are ORM rows with one method each and are
the closest thing the backend has to the declarative class without qualifying
for it.

*Remainder:* `core/request_logging.py` (47, 98.4%),
`core/exceptions.py` (20, 86.4%), `features/jobs/models.py` (80, 97.5%),
`features/matches/models.py` (38), `features/players/models.py` (31),
`smurf_boost_detection/models.py` (26).

Recounted 2026-08-19 against a regenerated report (57.52%, 636 tests); the
57.18% above was measured before the last three iterations landed.

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

`evaluators.py` **has been struck from this list** — see its row above. It is
the largest single hole in either half of the codebase and it has no caller:
the endpoints are mounted, nothing invokes them, and the frontend route of the
same name is a redirect. That is a decision for the owner, not an iteration.

`auth/service.py` is now the one with the most at stake per missing line, and
the next backend target worth the cost.
