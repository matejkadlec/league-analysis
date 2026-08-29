# Test-quality scout — 2026-08-29

One question: **what mechanically catches a test that passes while the behaviour it
names is broken?** Coverage does not — it measures execution, not verification, and an
AI writing tests to a coverage number optimises for exactly that gap.

Bar used: works on the pinned stack (Python 3.14 / pytest 9 / Vitest 4 / Node 26.7 /
React 19), actively maintained as of this week, and either catches a slop shape no
existing gate step catches, or costs nothing. Versions were checked against PyPI/npm
registry JSON and upstream changelogs on the date above.

Three facts found on the way decide three of the questions outright:

1. **The gate already runs a real PostgreSQL 18.6.** `compose.gate.yml` starts one on
   tmpfs with a healthcheck. The suite is offline by *choice*, not by *constraint*.
   This kills testcontainers, pytest-postgresql and SQLite in one line. (Half wrong as
   first written: compose hands those variables to the *container*, but `test.sh`'s
   pytest step then hard-coded `POSTGRES_HOST=127.0.0.1` over them, so the tier skipped
   inside the very environment built to run it. Fixed by making those four defaults
   rather than overrides.)
2. **CI is this Pi** — `[self-hosted, pi5ram16]`, 4x Cortex-A76, 16 GB. Every runtime
   number below is measured on the machine that pays it.
3. **The frontend suite was flaky on that hardware**: 2 failed / 1043 passed in 354.53s,
   while the failing file passed alone in 18.66s.

---

## 1. ADOPT

### 1.1 `expect.requireAssertions: true` — one line in `vitest.config.mts`

Vitest 4 has a first-party flag that calls `expect.hasAssertions()` at the start of
every test. A test with zero `expect` calls fails instead of passing. This is the exact
gap `house/meaningful-tests` declares out of scope in its own header — that rule reads
matchers, so a test with no matcher is invisible to it.

Zero packages, zero runtime cost, no knip surface. Measured fallout after the slop
fixes landed: **zero failures across 1038 tests**.

Two documented caveats, both checked here. It counts only Vitest's `expect` — `assert`
and `.should` do not satisfy it, which is why the fallout was measured rather than
reasoned about. And under `sequence.concurrent` the global `expect` can produce false
negatives (vitest#8469), i.e. the setting quietly stops working; this suite uses no
concurrent tests, verified by grep, so it does not apply. Re-check that if `concurrent`
is ever introduced.

### 1.2 Ruff `PT` ruleset — one config line

Not enabled before. Most of `PT` was already true here by convention; the two rules that
earn it are **PT011** (`pytest.raises(ValueError)` with no `match=` — the shape a
generator produces for every error path, and it passes on the `ValueError` a bug raises
as readily as the one the test names) and **PT018** (`assert a and b`, where one half can
rot silently). Measured impact: 6 × PT011, 12 × PT018, 1 × PT012.

Leave `raises-require-match-for` at its default. Do **not** add `HTTPException`: the 31
`pytest.raises(HTTPException)` sites discriminate on `excinfo.value.status_code`, which
is a better assertion than a message regex.

Already covered by the existing `B` and `RUF` selections, do not re-add: `B017` (blind
`pytest.raises(Exception)`), `B011`, `B015` (a forgotten `assert`), `B018`, `RUF043`
(a `match=` string that is accidentally a regex), `RUF018`.

### 1.3 `strict = true` — pytest 9's umbrella, one line

Originally scoped as `strict_xfail = true` (pytest 9 renamed `xfail_strict`; default
`false` means an `xfail`ed test that **starts passing** stays silent — a slop shape with
a delay fuse). Verified against the docs afterwards and widened: pytest 9 added an
umbrella `strict` ini option enabling `strict_config`, `strict_markers`,
`strict_parametrization_ids` and `strict_xfail` together.

The fourth is the one that was missing. `strict_parametrization_ids` immediately caught
**11 duplicate ids** in `tests/test_timestamp_columns.py`: the `ids=` callable rendered
the `Column` half as `""`, so every table's `created_at` and `updated_at` case shared one
name (`auth.users-`). Unselectable by node id, and a failure could not say which column
broke.

Written as ini options rather than `addopts` deliberately. pytest 9.0 **silently ignored**
`--strict-config` / `--strict-markers` when they arrived through `addopts`
(pytest-dev/pytest#14442 — `OverrideIniAction` did not cope; unknown markers warned
instead of erroring). Fixed by 9.1.1, which is what this repo pins, and confirmed here by
probe: an unknown marker still errors. But a strictness flag that has once gone quiet is
worth spelling the way that cannot. All four were then proven to fire by probe —
unknown marker, duplicate ids, XPASS, unknown ini option.

### 1.4 `time-machine >= 3.5.0` when a clock is next mocked — not `freezegun`

`time-machine` 3.5.0 ships Python 3.14 and 3.15 classifiers; `freezegun` 1.5.5 stops at
3.13 and has not shipped in a year. On a 3.14-pinned backend that is the whole decision.
Not urgent — recorded so the wrong one is not reached for. Note that no Python clock
patch reaches `func.now()` (16 sites): freeze the app clock, assert on the DB clock's
ordering.

---

## 2. TRIAL

### 2.1 Fix the measured flake before adding anything

A flaky test is a slop test with extra steps — green when the behaviour is broken, red
when it is fine, and it trains everyone to re-run rather than read. Adding signal on top
of a suite that already fails 1-in-N is adding signal to noise.

**Resolved 2026-08-29.** Cause was not the tests: Vitest's default `testTimeout` (5000ms)
exactly equalled the `asyncUtilTimeout` set in `vitest.setup.ts`, so the test's own
deadline always fired first — reporting a bare timeout instead of Testing Library's DOM
dump, and forcing several sequential `waitFor` calls to share one 5s budget. Fixed with
`testTimeout: 20_000`. Suite wall clock went 354s → 159s.

### 2.2 `@stryker-mutator/core@10.0.0` — frontend mutation testing, ad-hoc

Mutation testing is *the* general answer to this brief. ThoughtWorks Technology Radar
vol. 34 (April 2026) places it at **Trial** — *not* Adopt, which an earlier draft of this
file claimed and which verification against the Radar entry disproved. The *reason* it
gives is exactly on brief: "With AI-generated test cases now commonplace, mutation
testing acts as a reinforcement layer for catching 'perpetually green' tests — those that
pass regardless of logic changes due to missing assertions or decoupled mocks."

Compatibility is exact: 10.0.0 (2026-08-14), `engines.node >= 22`; the vitest runner
supports Vitest 4 since 9.4.0, with v4.1 hitcount fixed in 9.6.1, and its own devDeps
pin `vitest@4.1.11` / `react@19.2.8` — this repo's versions.

Run via `npm exec @stryker-mutator/core@<exact>` so nothing enters `package.json`.
**Never in the gate**: whole-repo mutation is a multi-hour job on 4 aarch64 cores. The
usable mode is per-diff — `--mutate "$(git diff --name-only master... -- ...)"` with
`incremental: true`. Set `break: null`; a mutation score is a diagnostic, not a gate
number.

**Hard blocker worth knowing now:** the Stryker vitest runner does not support Vitest
browser mode (stryker-js#4557). Browser mode and frontend mutation testing are mutually
exclusive. Choose mutation testing.

### 2.3 DB-backed tests against the Postgres the gate already starts

**The answer to "what does an all-mocked DB layer miss", needing no new dependency.**
Compiled-statement assertions genuinely catch "we went back to SELECT-then-branch". They
cannot catch: an `on_conflict_do_update` whose target has no matching unique index (8
upsert sites); an enum value with no `ALTER TYPE` behind it; **JSONB** semantics (33
sites — containment, `None` vs SQL NULL vs JSON `null`); server defaults and `func.now()`;
constraint, cascade and transactional behaviour.

Wiring: a `tests/integration/` directory, a session-scoped fixture creating a throwaway
database from the existing `POSTGRES_*` env (mirror the `lga_migration_validation_<uuid>`
naming discipline and identifier guard in `scripts/validate_migrations.py`), one
`alembic upgrade head`, sessions inside a rolled-back outer transaction. Every test
carries `@pytest.mark.enable_socket`, so `--disable-socket` keeps protecting the rest.

**The one piece of real design work:** `./test.sh -b` outside compose has no Postgres, so
these must *skip* cleanly on connection failure, not fail. Fall back to create/drop per
module before reaching for any library.

### 2.4 `msw@2.15.0` for the TanStack Query / axios tests

**32 frontend test files call `vi.mock("@/lib/core/http/api")`** — over-mocking at scale:
the component proves it calls a function that no longer has to exist, returning a shape
the real client no longer has to produce. `tests/api-contract-alignment.test.ts` exists
precisely to compensate for this, by its own comment.

MSW moves the seam to the network, so the real axios client, its interceptors, token
refresh queueing and zod validation all run. **Experiment:** convert one hook test, then
change the URL in the source — the converted test should fail where the mocked one
passed. **Abort if** the auth interceptor's `sessionEpoch` teardown ordering cannot be
driven through MSW responses; a split (module mocks for session-lifecycle suites, MSW for
data-fetching) is a fine outcome. Do not attempt all 32 in one branch.

### 2.5 `pytest-randomly` — order independence

**Adopted 2026-08-29.** Reseeds `random`, shuffles within modules, resets per-test seeds.
The concrete reason to want it: `conftest.py` had an autouse fixture resetting one
process-wide class attribute, found by hand — randomised order is how the next one gets
found by machine. Proven over **20 seeds, 0 failures** before adopting; a gate that fails
on a seed would be a flaky gate. The frontend equivalent is `sequence.shuffle`, free, and
it immediately caught a real leak (a spec appending a node to `document.body` outside
React, which RTL cleanup does not own).

---

## 3. SKIP — settled, do not re-research next quarter

1. **`testcontainers-python`, `pytest-postgresql`, SQLite-in-memory.** All three solve
   "get a Postgres for the tests"; `compose.gate.yml` already got one. testcontainers
   would start a second Postgres inside a gate container needing a mounted Docker socket;
   `pytest-postgresql` needs `initdb`/`pg_ctl` binaries absent from the gate image. SQLite
   is wrong on its own terms: 33 JSONB sites, 8 `ON CONFLICT` sites, native enum columns
   and `func.now()` — it would accept statements Postgres rejects and reject ones it
   accepts, i.e. a second, worse mock.
2. **`cosmic-ray`.** Actively maintained — 8.7.0 shipped 2026-08-09 — it simply has not
   added a 3.14 classifier where mutmut has, and it wants a session database, worker
   config and a separate report step against mutmut's built-in incremental cache. Not
   abandoned; just the more setup for the weaker 3.14 claim. If mutmut's `mutants/` copy
   defeats this suite, the answer is "no backend mutation testing this quarter", not
   "try cosmic-ray".
3. **Vitest browser mode for component tests.** Genuinely higher fidelity, but adopting
   it costs three things at once: `jsdom` and `@testing-library/react` come out, ~170
   files get rewritten against `page` locators, and **Stryker becomes impossible**. The
   repo already owns the high-fidelity tier: Playwright + `@axe-core/playwright`. jsdom
   for logic, Playwright for the browser, and the middle tier stays mutation-testable.
4. **`pytest-assertcount`.** Four years stale, and it only prints a suite-wide total — it
   cannot fail a specific assertion-free test. `scripts/check_tests.py` is the answer.
5. **`freezegun`.** Superseded by time-machine on a 3.14 backend (§1.4).
6. **`pytest-xdist`.** Makes the suite faster, not truer. It also hides the ordering bugs
   `pytest-randomly` exists to expose, and would multiply §2.3's DB fixtures. On 4 cores,
   with the backend inside budget and the frontend already contended, more parallelism is
   the wrong direction.
7. **`hypothesis` and `schemathesis`.** Both excellent, both the wrong shape for this
   brief: they find *bugs in the app*; this is about *lies in the tests*. Real candidates
   for a different scout — the rate limiter's burst arithmetic is a textbook target.
8. **`syrupy` / `inline-snapshot`.** Snapshot testing is a slop *generator*, not a slop
   detector: an approved snapshot is an assertion nobody read. The repo has none. Keep it
   that way.
9. **`pytest-timeout`.** *Adopted after all*, at `timeout = 60`: the original reasoning
   (no sockets, no real DB, so the only hang mode is a patched `asyncio.sleep`) holds
   today, but under `asyncio_mode = "auto"` a hang costs CI's full 90-minute job timeout
   and names no test. Cheap insurance, and a precondition for §2.3.
10. **Ruff `S` (bandit) on `tests/`.** `S101` bans `assert`, which is the entire testing
    idiom, so enabling `S` there means adding a ruleset to immediately disable its only
    relevant rule. `S` already runs against `app` and `scripts`. `FBT` and `ARG` are
    style, not slop — `ARG001` fires on every intentionally-unused pytest fixture.

---

## 4. Mechanizable slop shapes

`house/meaningful-tests` covered two shapes (all-`expect`s-are-call-matchers; bare
`toThrow()`). The rest, with what now covers each:

### 4.1 Backend — `scripts/check_tests.py`, wired as a gate step

| Shape | Status |
|---|---|
| Assertion-free test | **custom** — highest value; implemented |
| `assert True` / truthy constant | **custom** — implemented (`B011` covers only `assert False`) |
| `assert x == x` | **custom** — implemented |
| Every assertion inspects a mock | **custom** — implemented, a direct port of the frontend rule |
| Bare `x == y` statement | already on: `B015` |
| `pytest.raises(Exception)` | already on: `B017` |
| Broad `pytest.raises` with no `match=` | `PT011` |
| Multi-statement `pytest.raises` block | `PT012` |
| Composite assertion | `PT018` |
| xfail that starts passing | `strict_xfail` |
| Magic-number expectation | `PLR2004` — **skip**, style, and deafening in tests |

Two shapes were designed and deliberately **not** implemented, because both must be
conservative and neither has an off-the-shelf implementation: *mocking the unit under
test*, and *asserting against a constant imported from the source*. A test legitimately
imports the enum it asserts on. Scope any future attempt to computed constants, not to
types and enums.

Two decisions worth keeping. **Absence assertions** (`assert_not_called`,
`assert_not_awaited`) count as outcome assertions, not wiring checks: when the claim is
that nothing happened, the missing call *is* the observable outcome. **Assertions inside
a nested function count**, because this suite's `httpx.MockTransport` handlers assert on
the request they are handed — skipping callback bodies would report its most thorough
tests as asserting nothing.

### 4.2 Frontend

| Shape | Status |
|---|---|
| Test with zero `expect` | `expect.requireAssertions` — runtime, better than a lint |
| `fireEvent` for a user action | **custom** — `house/no-fire-event-click`, implemented |
| `expect(true).toBe(true)` | **custom**, trivial — not implemented, zero instances today |
| Only-existence assertions (`toBeDefined`, `toBeTruthy`) | **custom**, ~120 sites, readability-only — warn-level at best |
| Snapshot with no reviewer | **custom** — ban outright; the repo has none, so it starts green |
| `vi.mock` of the module under test | **custom**, high signal; the 32 `vi.mock` sites are *adjacent* mocking, one refactor away from this |
| Empty mock factory `vi.mock(x, () => ({}))` | **custom** — every consumer sees `undefined` |
| Unawaited `expect(p).resolves...` | `vitest/valid-expect`, currently `off` because it rejected Vitest's two-arg `expect`. Re-check on the next oxlint bump |
| Asserting an imported constant | **custom**, best catch rate but ~30% false positives — skip or warn-only |

### 4.3 Not mechanizable, enforce by review

The 2026 Testing Library consensus, unchanged: `getByRole` first, then `getByLabelText`
for form fields, then `getByText`; `getByTestId` is a last resort *because the user
cannot see or hear a test id*, so a passing test-id query proves nothing about
reachability. `eslint-plugin-testing-library` encodes this but the repo has no ESLint,
and running it through oxlint's compatibility layer is a bigger experiment than the rules
are worth.

The strongest findings in both audits were semantic and no AST rule reaches them: a test
name promising a universal rule while the body checks a literal list, and a test
exercising UI that production renders `display:none`. Those need a human, or a mutation
run.

---

## 5. Verified against primary sources

The first pass of this file was assembled without going to the web. A second pass on the
same day checked every load-bearing claim against PyPI/npm registry JSON, upstream
changelogs and vendor docs. What it changed:

- **The Radar ring was wrong** (Adopt → Trial). Corrected in §2.2. The rationale quoted
  there is verbatim and accurate; only the ring was invented.
- **pytest 9's umbrella `strict`** was missed entirely, and with it
  `strict_parametrization_ids` — which then found 11 duplicate ids. See §1.3.
- **`PGH005`** (`mock.assert_called` without parentheses — an attribute access that is
  always truthy and asserts nothing) and **`PLR0124` / `PLR0133` / `PLW0129`** were
  missed. All four now selected; zero findings today, so they are pure regression
  guards. `F631` (`assert (a == b, "msg")`, always true) and `B015`/`B017`/`B018`/`B011`
  were already covered by the existing `F` and `B` selections.
- **cosmic-ray is maintained**, contrary to the implication in §3.2.
- **Vitest ships an official [Writing Tests with AI](https://vitest.dev/guide/learn/writing-tests-with-ai)
  guide**, which this brief should have started from. It names the same failure modes
  independently: `expect(x).toBeDefined()` "passes for almost anything"; AI "tends to
  over-mock… asserts that specific internal methods were called in a specific order";
  and it recommends `restoreMocks: true` globally because generated tests set up spies
  and never restore them. All three were adopted here before reading it.

Two claims did **not** survive and are recorded so they are not repeated: pytest-randomly
has no substantiated current rough edge with pytest-asyncio (the cited issue is from 2021,
closed the next day, and root-caused elsewhere), and no maintained general-purpose
"AI slop test detector" exists for either language as of 2026-08 — mutation testing plus
lint rules is the state of the art, which is what this file recommends.

One challenge worth keeping open: §2.3's compiled-SQL assertions are arguably themselves
the tautology this document exists to remove — they restate the query builder's output
rather than proving the query returns correct rows. SQLAlchemy documents a first-class
"join a Session into an external transaction" recipe for test suites. That strengthens
§2.3 from a nice-to-have to the most valuable open item.

## 6. Verification notes

Versions and dates came from PyPI/npm registry JSON and upstream changelogs fetched
2026-08-29. Repo measurements came from `grep`/`find` over the working tree at commit
`25c3c50`, and the `PT` counts were confirmed by running `ruff check --select PT tests`
(19 findings, matching the estimate). Neither mutation tool was executed; both cost
estimates are extrapolations from measured suite times.
