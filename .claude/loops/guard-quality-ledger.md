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
9. `features/matches/components/match-history.tsx` — 88.7% / 85.0%.
10. `features/smurf-boost/components/*` — four files, all ≥90%.

`proxy.ts` is in the coverage scope; check its number when regenerating.

### Zero-covered — decide, do not mutate

19 files at 0% with ≥10 statements. Largest first:

- `app/settings/use-change-email.ts` — 117 stmts, the single biggest untested
  unit in the frontend, and it mutates account identity.
- `features/jobs/components/job-executions.tsx` — 61
- `features/matchmaking/components/matchmaking-analysis-history.tsx` — 58
- `app/settings/riot-api-settings-card.tsx` — 57. Feeds the key path that took
  ingestion down for a day.
- `app/settings/email-code-inputs.tsx` — 56
- `app/settings/password-change-section.tsx` — 51
- `features/jobs/components/job-execution-format.ts` — 50
- `features/profile/components/recent-performance-card.tsx` — 41
- `app/settings/display-name-field.tsx` — 38
- `features/profile/components/role-stats-card.tsx` — 31
- …plus 9 more in the report.

### Backend

Not yet enumerated. Backend coverage is armed by `--cov` in `test.sh` with
`fail_under = 47`; generate the equivalent report and append the same two
classes here before starting backend iterations.
