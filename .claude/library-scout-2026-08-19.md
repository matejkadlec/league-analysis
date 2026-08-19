# Library scout — 2026-08-19

Tier 2 of the same day's dependency pass. Tier 1 (`.claude/wheel-audit-2026-08-19.md`,
filed on commit `91e93aa` — not on this branch, read it with
`git show 91e93aa:.claude/wheel-audit-2026-08-19.md`) covered what an **already
installed** library or a native API replaces. This report covers the next tier only:
hand-written code that is an ongoing maintenance burden and where a **new** dependency
might pay for itself. 11 burdens researched.

Bar used: saves more code than it costs to integrate, actively maintained, works on the
pinned stack (Python 3.14 / React 19 / Next 16 / zod 4).

---

## 1. ADOPT

**None.** Nothing cleared the bar without a deciding experiment still outstanding. Four
candidates are worth the experiment (§2); seven are settled no (§3). An empty ADOPT list
is the expected outcome in a repo that runs deptry and knip in the gate and deleted 6,900
lines for sport — it is not a failed search.

House convention if a trial converts: `>=` floors in `backend/pyproject.toml` /
caret ranges in `frontend/package.json`. Exact `==` pins are reserved for tools whose
output is the gate itself (ruff, pyright).

---

## 2. TRIAL — one experiment each, ranked by payoff

### 2.1 `@hey-api/openapi-ts` (zod plugin) → `frontend/lib/core/schemas.ts` (~650 lines)

Largest possible win. Blocked on a backend fix, not a tool choice.

- **Prerequisite (do this regardless):** `backend/app/features/players/schemas.py`
  declares `summoner_level` / `profile_icon_id` required-non-null while
  `players/models.py` has them `Mapped[int | None]`. The hand-written zod is deliberately
  more lenient to compensate. Codegen would faithfully reproduce the over-strict Pydantic
  contract and start throwing on real null rows. Already logged in the wheel audit's
  PARTIAL section — fix the nullability first.
- **Experiment:** generate zod-only output (no SDK/client plugins) against the live
  `/openapi.json` for the players slice (~10-15 schemas). Diff against the current
  hand-written equivalents.
- **Abort if:** nullable/optional fidelity or `z.coerce.number()` on id fields still needs
  hand edits after every regeneration. A generated file that needs per-schema patching is
  the same maintenance burden with an extra tool bolted on → SKIP.
- **Rejected alternatives:** `openapi-zod-client` (author-declared unmaintained, ~1y stale);
  `orval` (active, 8.24.0, but zod is a secondary output mode and its open issues #2933 /
  #3171 are exactly the required/nullable fidelity questions this burden lives on).
- **Gate wiring:** none if run via `npm exec @hey-api/openapi-ts@<exact>` from an npm
  script — version pinned inside the script, zero `package.json` entry, zero knip surface,
  no CI step (regeneration stays manual). Only add a devDependency if that proves awkward.

### 2.2 `tenacity >=9.1.4` → `backend/app/core/riot_api/client.py:236-461`

**ADOPTED 2026-08-19** (tenacity 9.1.4, commit `2017ee0` on
`loop/guard-quality-14`). The experiment ran exactly as the decider asked: a
new end-to-end 429 oracle was committed green against the hand-written loop
first, the logging suites survived the swap unchanged, and only the
helper-signature tests needed mechanical edits. Four mutations against the
new wiring shown red/green. The `AsyncRetrying` instance passes
`sleep=lambda s: asyncio.sleep(s)` so tests patching `asyncio.sleep` keep
observing every wait.

Retires ~60-90 of ~180 lines: the attempt loop, attempt counting, the two `2**attempt`
sleep sites, and the `(should_retry, sleep_seconds)` tuple threaded through
`_handle_http_error_status` → `_execute_single_request` → `_make_request`. Riot-specific
classification (status→exception mapping, header parsing, PUUID special case, structured
logging) stays hand-written. Zero transitive deps, Apache-2.0, py314 in its own CI matrix.

- **Experiment:** on a branch, wrap `_execute_single_request` with
  `@retry(retry=retry_if_exception_type(RiotRetryableError), wait=wait_exception(...),
  stop=stop_after_attempt(4), reraise=True)` and raise on every retryable hit instead of
  returning the `None` sentinel. Keep `response.aclose()`, the rate-limiter call and the
  credential-health callback correctly sequenced around the now-exception-driven flow.
- **Decider:** do `backend/tests/test_riot_api_boundaries.py` and
  `backend/tests/test_riot_client_logging.py` survive with mechanical edits?
- **Abort if:** either needs a wholesale rewrite — the test cost then exceeds the 60-90
  lines saved and this becomes SKIP.
- **Gate wiring:** plain entry in `[project].dependencies`. Imported by app code, so no
  `[tool.deptry.per_rule_ignores]` DEP002 line. Nothing else.

### 2.3 `@axe-core/playwright@4.13.0` → `frontend/e2e/` (net-new coverage, retires 0 lines)

**ADOPTED 2026-08-19** (commit `cbf39a0` on `loop/guard-quality-14`), as its
own spec (`e2e/accessibility.spec.ts`) over the three populated player routes
rather than inside the reflow spec. The first run found three real defects,
all fixed in the same commit: combobox ARIA attributes without the combobox
role on the player search, the match list scrollable without keyboard
access, and three match-row metadata spans under 4.5:1 on the win/loss tint.
One correction to this section's premise: axe does NOT cover WCAG 1.4.1
use-of-color — no automated rule does — so the match-row tint finding stays
open in IMPROVEMENTS.md.

Not a code-deletion candidate: it closes a demonstrated uncaught defect class (WCAG 1.4.1
colour-only signalling, already found by hand in `match-row.tsx`). Deque's own package,
released 2026-08-11; only dependency is `axe-core ~4.13.0`; couples to Playwright 1.62.1
only, nothing to React/Next/zod.

- **Experiment:** `new AxeBuilder(page).analyze()` asserting zero violations inside
  `e2e/player-pages-mobile.spec.ts`, across its three existing routes.
- **Promote if:** clean or a small fixable list → move to a shared `e2e/support` helper
  used by all 7 specs.
- **Abort if:** a flood of pre-existing violations across the ~20 conditional-styling
  components. That is signal for an a11y remediation pass first, not against the library —
  don't let a cheap add turn into an unplanned project.
- **Rejected alternative:** community `axe-playwright` — 11 months stale, drags in
  junit-report-builder / axe-html-reporter / picocolors for reporting nobody needs.
- **Gate wiring:** devDependency; e2e already runs in `./test.sh`, no new step. One
  unverified caveat: the repo has no `knip.json` and `npm run deadcode` scans
  `devDependencies`; confirm knip's playwright plugin treats `e2e/*.spec.ts` as entries in
  one run, and add `ignoreDependencies` only if it doesn't.

### 2.4 `downshift@9.4.0` (`useCombobox`) → `frontend/features/players/components/player-selector.tsx`

Lowest priority, partial payoff. Retires ~50-60 of the ~90 burden lines: `highlightedIndex`
state, ArrowUp/Down/Enter/Escape handling, `aria-activedescendant` / `role=listbox` /
`role=option` wiring. Debounce and all domain logic (react-query fetch,
`submitUnknownPlayer` fallback, platform dialog) stay. Headless, so no second styling
paradigm next to Radix/shadcn; `react >=16.12` peer range covers React 19.

- **Experiment:** rewrite the component on a branch against
  `getInputProps`/`getMenuProps`/`getItemProps`, folding the "search Riot for this
  Name#Tag" fallback into the items array so it keeps its place in the arrow/tab order.
- **Abort if:** the net diff isn't smaller once the keyboard/aria tests are re-pointed at
  downshift's DOM ids and event model.
- **Rejected alternatives:** `cmdk` (~1y stale, open unresolved React 19 peer-dep issue
  #266, and its client-side-filter model fights server-fetched async suggestions);
  `react-aria-components` (well maintained but imposes a whole second component system for
  no payoff over a plain hook).
- **Gate wiring:** dependency in `frontend/package.json`; imported by a component, so knip
  sees it. Nothing else.

---

## 3. SKIP — settled, do not re-research next quarter

1. **`backend/app/core/riot_api/rate_limiter.py`** (pyrate-limiter, aiolimiter) — both are
   *self-tracking* limiters with no API to seed a bucket from Riot's server-reported
   `X-App/Method-Rate-Limit-Count`; the reconciliation glue would be as big as the ~80-100
   lines saved. The libraries that do parse Riot headers (Riot-Watcher, Cassiopeia) only
   ship it inside a whole API-client framework.
2. **`backend/app/core/riot_api/db_rate_limiter.py`** (pyrate-limiter PostgresBucket,
   limits) — only the generic ~150/652 lines are covered; the bulk is a bespoke 3-tier
   priority-preemption scheduler, per-component wait budgets, the `is_waiting` DB flag and
   progress callbacks that no rate-limit library models. `limits` has no Postgres backend at
   all (Redis-only, and this stack has no Redis).
3. **`backend/app/features/jobs/scheduler.py`** (arq, taskiq) — both need a Redis/RabbitMQ
   broker this single-Pi deployment doesn't run, to replace the ~15% that APScheduler's
   Postgres `SQLAlchemyJobStore` already does. The 85% that matters (DB-authoritative config
   sync, startup recovery, orphan cancellation, overdue catch-up) is hand-written against
   either. arq is additionally in self-declared maintenance-only mode.
4. **`backend/app/features/auth/service.py` + cookies/refresh-token models** (fastapi-users,
   authx) — neither implements rotating refresh tokens with reuse detection or family-wide
   revocation (fastapi-users #350, open for years; authx's "refresh" just re-mints an access
   token), and neither has any concept of the client-readable session-hint cookie synced
   with the HttpOnly refresh cookie that #90/#91 just hardened. ~0% of the actual burden,
   high migration cost, real security-regression risk.
5. **`backend/scripts/validate_migrations.py`** (pytest-alembic, alembic-verify) — reach only
   the single-head and model-vs-schema-drift checks (~5-15% of 900 lines). The burden is
   pg_dump snapshot round-trips and seeded legacy rows proving specific backfills repair
   them — irreducibly project-specific. pytest-alembic is 15 months stale with long-open
   async gaps and its Docker DB-lifecycle helper duplicates `migrate.py`'s advisory lock.
6. **`frontend/features/matchmaking/*` state machine** (xstate) — replaces only the ~50-line
   reducer switch out of 731 lines; the anchor/reanchor progress-projection math and
   phase-to-display derivation are domain numerics no FSM library touches. The lighter
   sibling `@xstate/fsm` is deprecated.
7. **`frontend/lib/core/api.ts` + `token-manager.ts`** (axios-auth-refresh,
   axios-auth-refresh-queue) — cover only the generic "queue concurrent 401s, retry once
   refreshed" mechanic; the `sessionEpoch` teardown ordering and the `SESSION_ENDING_CODES`
   allowlist that separates a real 401 from a Cloudflare WAF challenge (both bought with
   production incidents, see 2139a0d / df5f5ed) stay hand-written on top of someone else's
   interceptor lifecycle.

---

## 4. Weight if every TRIAL converts

| | Added | Retired |
|---|---|---|
| tenacity | 1 package, 0 transitive (backend runtime) | ~60-90 lines of `client.py` |
| @hey-api/openapi-ts | 0 manifest entries (npx, pinned in script) | most of `schemas.ts` (~650 lines) |
| @axe-core/playwright | 2 packages (itself + axe-core, dev-only) | 0 — net-new coverage |
| downshift | 1 package + prop-types (frontend runtime) | ~50-60 lines of `player-selector.tsx` |

**Net: 4 manifest entries (1 backend runtime, 1 frontend runtime, 1 frontend dev, 1 none)
against roughly 750-800 hand-written lines retired.** All of that hinges on the schemas.ts
trial — without it the trade is 4 packages for ~120 lines plus a11y coverage, which is a
much weaker deal. Run 2.1 first.

Non-dependency follow-up surfaced on the way: the ~40-line burst-spacing clock is duplicated
between `rate_limiter.py` and `db_rate_limiter.py`. Internal dedup, no library involved.
