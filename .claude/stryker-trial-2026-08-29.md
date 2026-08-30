# Stryker trial — 2026-08-29

**Verdict: ADOPT-NARROWED.** Per-diff only, and only over feature-local code
(`features/**`, hooks, reducers) — never `lib/core/**`. It named real gaps that four
rounds of test-quality review did not, the sharpest being a rank average asserted only
over a one-element set, where `sum / n` and `sum * n` are the same number.

It is not a gate and not a habit: one feature slice cost **68 minutes** on this Pi, and
a 501-line `lib/core/**` slice projected **~1 h 55 m** and was killed at 38 minutes.
Presentational noise was **14.5 %** of survivors, not the majority — so the abort
criterion was not met, but the cost criterion is what narrows it.

Measured on `test-quality-anti-slop` (`aa59a6b`), `@stryker-mutator/core@10.0.0` +
`@stryker-mutator/vitest-runner@10.0.0`, Node 26.7.0, 4× Cortex-A76, `concurrency: 3`.

---

## 1. Cost

| | A: `features/matchmaking/**` | B: `lib/core/riot/**` |
|---|---|---|
| source lines / files | 2 977 / 19 | 501 / 6 |
| mutants | **1 631** | **326** |
| related tests (Stryker's own selection) | 115 | **667** |
| dry run | **39 s** | **3 m 21 s** |
| mutation run | **68 min**, complete | **38 min for 213/326**, killed |
| projected full run | — | **~1 h 55 m** |
| score | **61.68 %** total / 66.40 % covered | 72.6 % of the 201 decided |

Slice A is the honest full number: 60 min for 1197 mutants before the run was
interrupted, then 8 min 8 s to finish the remaining 434 from the incremental file.
**≈ 2.5 s wall clock per mutant** at `concurrency: 3` — ~7.5 CPU-seconds each.

The two slices differ by 20× in cost per line, and that difference is the whole
recommendation. Slice A's 19 files pull 115 tests. Slice B's six files sit under
`lib/core/`, so Vitest's `related` resolution drags in most of the suite, and Stryker
runs it single-worker (§4.2). **Mutation testing here is affordable for leaf modules
only.**

Whole-frontend extrapolation: 23 290 source lines, mutant density flat at ~0.55/line →
**≈ 12 700 mutants**. At slice A's rate that is **~9 hours**; weighted for the shared
modules that behave like slice B it is realistically **a day**. Never in the gate.

The `incremental` file is what makes any of this usable. Both interrupts wrote
`Saved a partial incremental report … after an unexpected interrupt`, and the resumed
slice-A run reported `1197 of 1631 mutant result(s) are reused`. Nothing was lost either
time, and a re-run after a small diff only pays for the changed files.

## 2. The survivors that name a real gap

Slice A: 509 of 1631 survived, 116 no-coverage, **0 timeouts, 0 errors**. The seven
below are the case for the tool — each mutates production behaviour in a way the current
suite cannot see.

### 2.1 `scope-aggregates.ts:82` — the rank average is never averaged

```
values.reduce((sum, v) => sum + v, 0) / values.length
  →  values.reduce((sum, v) => sum + v, 0) * values.length      SURVIVED
```

The file is at 99.15 % statements / 100 % lines. The reason the mutant lives is in the
fixture. `tests/scope-aggregates.test.ts:204` is named *"averages unique matchmade
players per side only"* and asserts `allyAvg: 1800` against
`allyTierCounts: { PLATINUM: 1 }` — **one** player. `enemyAvg: 2200` likewise has one
*ranked* enemy; the other is `UNRANKED` and carries no value. With `values.length === 1`,
`sum / 1` and `sum * 1` are equal, so a test that claims to test averaging never averages
anything. A fixture with two ranked players on one side kills it.

### 2.2 `scope-aggregates.ts:42` — `trimmedMean` never sorts

```
[...values].sort((a, b) => a - b).slice(k, values.length - k)
  →  [...values].slice(k, values.length - k)                    SURVIVED  (MethodExpression)
  →  ...sort((a, b) => a + b)...                                SURVIVED  (ArithmeticOperator)
  →  ...sort(() => undefined)...                                SURVIVED  (ArrowFunction)
```

Both `TRIM_FIXTURES` (`tests/scope-aggregates.test.ts:54`) are already in ascending
order, so the sort is a no-op in every assertion. Trimming 10 % off each end of an
unsorted array trims arbitrary values, and the function's doc comment claims parity with
the backend's `trimmed_mean` — the sort is exactly the half of that claim nothing checks.
The fixture's own comment shows the author reasoned about the *trim* ("the n=5 fixture is
asymmetric so trimming below ten values fails it") and not about the *order*. One
shuffled fixture kills all three.

### 2.3 `use-matchmaking-analysis-mutations.ts:38` — the cache-clear filter is unasserted

```
queryClient.removeQueries({ queryKey: matchmakingStatusQueryKey(puuid) })
  →  queryClient.removeQueries({})                              SURVIVED
```

`removeQueries({})` matches every query in the client and wipes the whole cache. The
contrast inside the same feature is what makes this decisive: every sibling
`invalidateQueries` mutant is **killed**, because
`tests/matchmaking-analysis-lifecycle.test.tsx:399` asserts
`toHaveBeenCalledWith({ queryKey: [...] })`. The tool separates the asserted call from
the merely-called one; a reviewer does not, because the two lines look the same.

### 2.4 `matchmaking-analysis-session.tsx:120-127` — polling never has to stop

```
refetchInterval: (query) => {
  if (status === "completed" || status === "failed" || status === "cancelled") {
    return false;      →  return true;                          SURVIVED
```

Each of the three terminal-status comparisons also mutates to `false` independently and
survives. A build that polls the backend forever after a run finishes ships green. The
missing test: drive a watched run to `completed` and assert the status query stops
refetching.

### 2.5 `matchmaking-analysis-state.ts` — a 380-line state machine no test imports

Score **45.90 %** (122 survived, 43 no-coverage) on a file at 77 % line coverage, and the
worst-scoring non-trivial file in the slice. `grep` over `tests/` finds no importer of
`analysisUiReducer`, `resolveDisplayPhase`, `isActiveAnalysisStatus` or
`isSameAnalysisInstance`: the module is exercised only through components. Three
survivors that are behaviour, not decoration:

```
L78   isSameAnalysisInstance: return false;  →  return true;    SURVIVED
```
two absent analysis ids compare as the same run.

```
L219  if (action.authoritativeProgress <= projectedProgress) return state;
        →  ... < ...   SURVIVED
        →  ... > ...   SURVIVED
```
both directions of the re-anchor guard are equally acceptable to the suite, so nothing
pins whether a backend progress report re-anchors the projection or is ignored.

```
L122-124  isActiveAnalysisStatus: each of "pending" / "in_progress" /
          "waiting_rate_limit"  →  false                        SURVIVED
```
the function that decides whether a run is still live is untested on all three branches.

This file is the single biggest hole the run found: it wants a direct
`tests/matchmaking-analysis-state.test.ts`.

### 2.6 `use-shown-matchmaking-analysis.ts:24` — the cache key can be emptied

```
queryKey: [...matchmakingResultsQueryKey(puuid), selectedCreatedAt]
  →  queryKey: []                                               SURVIVED
```
Every player and every selected run would share one cache entry. 4 of this file's 5
mutants are killed; this is the one that matters.

### 2.7 `matchmaking-progress.ts` — the boundaries

```
L35  const activeRunCap = totalPlayers * 0.99;  →  totalPlayers / 0.99   SURVIVED
L28  Math.max(authoritativeProgress, 0)  →  Math.min(...)               SURVIVED
L27  totalPlayers <= 0   →  totalPlayers < 0                            SURVIVED
L81  spanMs < MIN_THROUGHPUT_SPAN_MS  →  spanMs <=                      SURVIVED
L93  remainingPlayers <= 0  →  remainingPlayers < 0                     SURVIVED
```
The cap exists so the bar cannot reach 100 % while an analysis is still running; the
mutant lets the projection exceed the total and nothing notices. The four `<=`/`<` pairs
are the classic missing-boundary signal — cheap to fix, and exactly what a reviewer skims
past.

Also worth a line: `matchmaking-api.ts:52` and `:63`, `{ signal }` → `{}` both survive —
the abort signal is threaded through but never proven to reach the client.

### 2.8 From slice B, before it was killed

Only two of the 55 survivors there are worth acting on, and one is a mutator class slice
A never produced:

```
data-dragon-version.ts:5   /^\d+\.\d+\.\d+$/  →  /^\d+\.\d+\.\d+/   SURVIVED
                                              →  /\d+\.\d+\.\d+$/   SURVIVED
```
Both anchors of the Data Dragon version pattern can be deleted. Nothing tests that
`16.15.1-beta` or `v16.15.1` is rejected — and this value is baked into a static build.

```
data-dragon-version.ts:30  next: { revalidate: 6 * 60 * 60 }  →  {}          SURVIVED
                                                             →  6 * 60 / 60  SURVIVED
```
The ISR window on the version fetch is unasserted; a mutant revalidating every 6 seconds
passes.

## 3. The noise, and how much of it there is

All 509 slice-A survivors classified by mutated source context, generously counting
anything within four lines of a `className` / `cn(` / `style=` / chart-styling prop as
presentational:

| category | count | share |
|---|---|---|
| presentational (`className` strings, CSS vars, Recharts style props, `[0,4,4,0]` radii) | 74 | 14.5 % |
| trivial (`""` ⇄ `"Stryker was here!"`, JSX `" "`) | 3 | 0.6 % |
| logic | **432** | **84.9 %** |

Strictly-CSS mutants are nearer 45-50 (~9 %); the 74 sweeps in conditionals that gate a
whole content block, several of which are real. **The abort criterion — "survivors are
overwhelmingly equivalent mutants in `className` / `cn()` composition" — is not met.**

Slice B has a *different* noise class that slice A does not: 25 of its 32
`data-dragon.ts` survivors are entries in static lookup tables
(`Kaisa: "Kai'Sa"` → `""`, `1: { name: "Cleanse", asset: "SummonerBoost" }` → `{}`).
Killing those means one assertion per champion, which is the tautology this branch spent
four PRs deleting. Data tables should be in `mutate`'s exclusions, the same as CSS.

Per-file scores show where the noise concentrates, and it is not where the brief guessed:

```
run-type.ts                          100.00      matchmaking-analysis-start-card.tsx   73.42
matchmaking-query.ts                 100.00      matchmaking-analysis-active-card.tsx  71.11
matchmaking-analysis.tsx             100.00      matchmaking-analysis-history.tsx      57.47
use-matchmaking-analysis-mutations.ts 95.35      matchmaking-analysis-results.tsx      50.86
gap-verdict.ts                        95.00      tier-distribution.tsx                 46.58
matchmaking-api.ts                    92.00      matchmaking-analysis-state.ts         45.90
scope-aggregates.ts                   88.03      matchmaking-analysis-session.tsx      41.22
matchmaking-progress.ts               80.82      analyzed-player-result-label.tsx      33.33
use-shown-matchmaking-analysis.ts     80.00      matchmaking-explanation-card.tsx      26.67
```

Two things fall out. The presentational leaves (`analyzed-player-result-label.tsx` at
33.33 % is four CSS-variable mutants in a six-mutant file) score badly for reasons nobody
should act on. But `matchmaking-analysis-state.ts` at 45.90 % is **pure logic**, and
`matchmaking-analysis-session.tsx` at 41.22 % is a `.tsx` file whose survivors are the
polling-stop condition and the query keys, not classes. So neither "only mutate `.ts`"
nor "skip `.tsx`" is the right filter. **Narrow by what the file does, not by its
extension.**

One survivor is a whole untested interaction rather than a detail:
`matchmaking-explanation-card.tsx:24`, `onClick={() => setIsExpanded(!isExpanded)}` →
`() => undefined`, survives because `tests/matchmaking-explanation-card.test.tsx` holds a
single test that renders the default expanded state and never clicks the toggle. Its
name — *"opens on the flowchart"* — describes precisely the half it covers.

## 4. Integration friction with the current config

**4.1 `vitest.related` drags most of the suite into any `lib/core/**` slice.** Stryker
asks Vitest for the test files related to the mutated files. For `features/matchmaking/**`
that is 115 tests and a 39-second dry run. For `lib/core/riot/**` it is 667 tests, a
3 m 21 s dry run, and 20× the cost per source line. This is the reason the verdict is
narrowed rather than plain ADOPT.

**4.2 The runner forces `pool: "threads"`, `maxWorkers: 1`, `maxConcurrency: 1`**
(`node_modules/@stryker-mutator/vitest-runner/dist/src/vitest-test-runner.js:31-53,74-83`).
The suite's own pool is `forks`. One test genuinely cannot survive the swap:
`tests/riot-api-settings-card.test.tsx:126` calls `vi.stubEnv("TZ", "America/New_York")`,
which has no effect inside a worker thread, so it fails on the formatted timestamp. That
is a real incompatibility, not a repo bug — any Stryker run whose related set includes
that file must exclude it.

**4.3 `.stryker-tmp/` breaks Vitest, and it is the root cause of most of slice B's
trouble.** Both the sandbox (`sandbox-*/`) and the `inPlace` backup (`backup-*/`) contain
a full copy of `tests/`, and `vitest.config.mts`'s `exclude` does not mention
`.stryker-tmp`. Vitest therefore collects every test file two or three times. Measured
effect on slice B's dry run: **12 min and 25 failing tests → 3 m 21 s and 1 failing test**
once excluded. It is also a live gate hazard on a normal checkout: after an aborted run,
`npx vitest run tests/recent-performance-card.test.tsx` executed
`.stryker-tmp/sandbox-sx7z0y/tests/…` as extra files and reported 10 failed / 8 passed.
**If this tool is used on a working checkout, add `"**/.stryker-tmp/**"` to
`test.exclude` in `vitest.config.mts`**, or the next person to run the gate gets an
unexplainable red.

**4.4 The sandbox breaks the eight cross-repo contract tests.** `tests/` has eight files
that read backend Python via `../backend/app/...` — `supported-queues-alignment`,
`smurf-boost-settings`, `password-policy-alignment` and five more. In the sandbox that
resolves to `.stryker-tmp/backend/...`:
`ENOENT … .stryker-tmp/backend/app/features/settings/schemas.py`. Fix is `inPlace: true`,
which mutates the real files and restores them from `.stryker-tmp/backup-*`. Verified: a
`SIGINT` mid-run restored every source file (`git diff` clean). Acceptable in a throwaway
worktree; not on a checkout with uncommitted work.

**4.5 It leaves droppings that fail the gate.** Each run writes
`frontend/stryker-setup-{0,1,2}.js` at the project root and does not remove them.
Measured with one such file present: `npm run deadcode` reports
`Unused files (1) stryker-setup-0.js`, and `npm run lint` reports
`unicorn(no-empty-file)`. **Always `rm -f stryker-setup-*.js && rm -rf .stryker-tmp`
after a run.**

**What did *not* cause trouble**, having been the main worry going in: the runner sets
`coverage: { enabled: false }` outright (`vitest-test-runner.js:77`), so the 89/84/86/89
thresholds never arm and never fail the runner's own executions. `expect.requireAssertions`,
`restoreMocks`, `unstubGlobals` and `testTimeout: 20_000` all passed through silently, and
`sequence.shuffle` did not disturb Stryker's per-test mutant mapping — 0 errors across
1 631 mutants. **`frontend/stryker.config.json` on its own is gate-safe**: measured, knip
reports nothing for it, contrary to the expectation that its Stryker plugin would flag
`@stryker-mutator/core` as an unlisted dependency. A `vitest.stryker.mts`, on the other
hand, *is* flagged (`Unused files (1)`), so keep that one out of the tree.

**Packaging.** `npm exec --package @stryker-mutator/core@10.0.0 --package
@stryker-mutator/vitest-runner@10.0.0 -c "stryker run"` resolves both packages but dies in
`ts-config-preprocessor.js` with `Cannot find package 'typescript'`: from the npx cache the
project's `typescript` (aliased to `npm:@typescript/typescript6`) is not resolvable.
`npm install --no-save` is the working form and leaves both `package.json` and
`package-lock.json` byte-identical — verified with `diff`.

## 5. Reproducing a per-diff run

```bash
export PATH="$HOME/.nvm/versions/node/v26.7.0/bin:$PATH"
cd frontend
npm install --no-save --no-audit --no-fund \
  @stryker-mutator/core@10.0.0 @stryker-mutator/vitest-runner@10.0.0

cat > /tmp/stryker.json <<'JSON'
{
  "testRunner": "vitest",
  "incremental": true,
  "incrementalFile": "reports/stryker-incremental.json",
  "concurrency": 3,
  "inPlace": true,
  "thresholds": { "high": 80, "low": 60, "break": null }
}
JSON

./node_modules/.bin/stryker run /tmp/stryker.json --mutate "$(
  git diff --name-only master... -- 'frontend/features/**/*.ts' 'frontend/features/**/*.tsx' \
    | sed 's|^frontend/||' | paste -sd,
)"

rm -f stryker-setup-*.js && rm -rf .stryker-tmp   # or the gate goes red (§4.3, §4.5)
git checkout -- .                                 # only if an inPlace run was interrupted
```

Add `--dryRunOnly` the first time you try a new slice: it costs 45 s and reports the
mutant count and the related-test set before you commit an hour to the real run.

`coverageAnalysis` is deliberately absent — the vitest runner ignores it and always uses
`perTest`. `concurrency: 3` is `cpuCount - 1` on this 4-core Pi; do not raise it.
`break: null` is deliberate: a mutation score is a diagnostic, not a gate number.

If a run must include tests that live under `.stryker-tmp` risk or the `TZ` test, point
Stryker at a throwaway config with `"vitest": { "configFile": "vitest.stryker.mts" }`,
where that file spreads `vitest.config.mts`'s `test` block and only widens `exclude`:

```ts
exclude: [
  ...configDefaults.exclude,
  "e2e/**",
  "**/.stryker-tmp/**",
  "tests/riot-api-settings-card.test.tsx",   // vi.stubEnv("TZ") needs pool: forks
],
```

Delete it afterwards — knip fails on it as an unused file.

## 6. What to do with what it found

In priority order:

1. A direct unit test file for `features/matchmaking/matchmaking-analysis-state.ts`.
   45.90 % on a 380-line state machine that no test imports is the biggest hole.
2. `tests/scope-aggregates.test.ts`: a two-ranked-player fixture (kills §2.1) and one
   unsorted `TRIM_FIXTURES` entry (kills §2.2). Two small edits, two real defects exposed.
3. Assert the `removeQueries` filter the way `invalidateQueries` is already asserted.
4. A test that a completed run stops polling.
5. Anchor-sensitive cases for the Data Dragon `VERSION_PATTERN`.
6. Click the explanation card's toggle.

And **do not chase the score**. The gap between 61.68 % and 100 % is mostly Tailwind
strings and champion-name tables; closing it would manufacture exactly the assertions this
branch exists to delete.

## 7. Verification notes

Every number above was measured on this box on 2026-08-29 — nothing is extrapolated except
the whole-frontend hours figure, which is linear in mutant count and stated as a floor.
Slice A's survivor counts come from `reports/mutation/mutation.json` of the completed run;
slice B's from the partial incremental report Stryker wrote on `SIGINT` (201 of 326 mutants
decided). The noise/logic split comes from a script classifying all 509 slice-A survivors
by mutated source context. Gate claims in §4.5 and the knip result were run, not reasoned:
`npm run deadcode` and `npm run lint` with and without each file present.

Nothing entered `package.json` or `package-lock.json`. `frontend/stryker.config.json` and
`frontend/stryker.riot.json` are left untracked and are gate-neutral;
`frontend/vitest.stryker.mts` was deleted because knip fails on it, and its content is
inlined in §5. `frontend/reports/` and `frontend/.stryker-tmp/` were added to `.gitignore`
and no generated report is committed.
