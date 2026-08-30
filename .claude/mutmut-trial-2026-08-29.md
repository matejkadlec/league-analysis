# mutmut trial — 2026-08-29

**Verdict: ADOPT-NARROWED.** mutmut 3.7.0 runs on this stack and its survivors name
real gaps — six were confirmed by hand-mutating the real source and watching all 1253
tests stay green. But it is a per-module, ad-hoc diagnostic run by a human, never a
gate step: whole-repo is a multi-hour cold job, and the wiring needs four corrections
that are easy to get silently wrong.

Every number below is from a cold run on the Pi (4× Cortex-A76), `--max-children 4`,
against `test-quality-anti-slop` (aa59a6b).

---

## 1. The decider: do the meta-tests survive the `mutants/` copy?

**Eleven of the twelve do. Exactly one needs handling, and the predicted
score-inflating lie does not happen — mutmut refuses to run instead.**

`also_copy` needed only three entries beyond mutmut's implicit ones:

```toml
also_copy = ["alembic/", "scripts/", "alembic.ini"]
```

mutmut 3.7 *always* copies `tests/`, `test/`, `pyproject.toml`, `setup.cfg`,
`uv.lock`, `poetry.lock`, `Pipfile.lock`, `pdm.lock` and root-level `test*.py`
(`configuration.py:_load_config`), so the brief's `also_copy` entries for
`tests/data/`, `tests/fixtures/` and `pyproject.toml` are all redundant. `alembic/`
is needed by `test_riot_vocabulary.py` (reads a specific revision file),
`scripts/` by `test_mirror_pi_postgres_to_local.py`, `test_check_tests.py` and
`test_check_comments.py`.

With that list, run from `backend/mutants/`:

```
1250 passed, 20 skipped in 23.36s      (baseline: 1253 passed, 20 skipped)
```

The three missing tests are the whole of `tests/test_frontend_api_paths.py`.

### The one file that cannot be fixed by `also_copy`

`tests/test_frontend_api_paths.py:17` does `REPO_ROOT = Path(__file__).resolve().parents[2]`.
`mutants/` is created *inside* `backend/`, so under it `parents[2]` is `backend/`,
not the repo root, and `FRONTEND` points at the non-existent `backend/frontend`.
Its module-level guard then fires **at collection time**:

```
tests/test_frontend_api_paths.py:30: in <module>
    assert API_MODULE.is_file(), f"the validated client is not at {API_MODULE}"
AssertionError: .../backend/frontend/lib/core/http/api.ts
```

`also_copy` cannot express the fix. Destinations are computed as
`Path("mutants") / path`, so every entry lands under `mutants/`; the one spelling
that escapes — `also_copy = ["../frontend/"]` — resolves to `backend/frontend` and
would `copytree` the frontend, `node_modules` and `.next` included, into the real
working tree. Two fixes actually work:

| Fix | Cost |
|---|---|
| `ln -s ../frontend backend/frontend` before the run | keeps all 1253 tests live; **verified — the full mutmut run below used it** |
| `pytest_add_cli_args = ["--ignore=tests/test_frontend_api_paths.py"]` | drops 3 of 1253 tests (0.24%); zero coupling to `app/`, so no mutant score is affected |

**Neither number needs a footnote.** `test_frontend_api_paths.py` asserts frontend
URL strings against `app.main`'s route table; it kills no mutant in any module that
is not a router. For non-router targets the two options are equivalent, and the
symlink makes them equivalent everywhere.

### The predicted failure mode does not materialise

The brief's worry — *"if they error, they kill every mutant for free and inflate the
score into a lie"* — is not reachable in mutmut 3.7. It gates on a clean baseline
twice before testing anything, and both gates fired here during wiring:

- `mutate_only_covered_lines = true` gathers coverage with a full suite run first.
  The collection error made that exit 4, and mutmut raised
  `BadTestExecutionCommandsException` and stopped.
- After stats collection it runs the suite once more with `MUTANT_UNDER_TEST=""`.
  A failure there prints `Failed to run clean test` and stops.

So a broken meta-test costs you a run, loudly. It does not buy you a 100% score.
This is the single most important trust finding here.

---

## 2. Four wiring corrections the brief's config gets wrong

The config in the brief does not load. In order of how much time each costs:

1. **`tests_dir = "tests/"` crashes mutmut on startup.** The documented key is read
   as a list and concatenated: `configuration.py:114` →
   `TypeError: can only concatenate list (not "str") to list`. Use
   `pytest_add_cli_args_test_selection = ["tests/"]`.
2. **`paths_to_mutate` is deprecated** in favour of `source_paths` (warns, still works).
3. **`source_paths` controls what is *copied*, not just what is mutated.** Setting it
   to the target file alone copies *only* that file into `mutants/app/`, and mutmut
   then deliberately deletes the original tree from `sys.path`. `app/` has no
   `__init__.py`, so `app` resolves as a namespace package while `app.core` (which
   does have one) binds to whichever tree wins — the imports either break or silently
   resolve to the *unmutated* original. Both were observed. Use
   `source_paths = ["app/"]` and narrow with `only_mutate`.
4. `do_not_mutate = ["app/features/*/schemas.py"]` is a no-op once `only_mutate` is set.

`pytest-randomly` is a **non-issue**: mutmut passes `-p no:randomly -p no:random-order`
itself on every invocation (`_pytest_args_regular_run`). Nothing to configure.

### Working config

```toml
[tool.mutmut]
source_paths = ["app/"]                                # what gets COPIED
only_mutate = ["app/core/riot_api/rate_limiter.py"]    # what gets MUTATED
pytest_add_cli_args_test_selection = ["tests/"]
also_copy = ["alembic/", "scripts/", "alembic.ini"]
mutate_only_covered_lines = true
```

---

## 3. A repo bug the trial found on its own

mutmut calls `pytest.main()` repeatedly in one process. That exposed a **fourth
process-global** that `tests/conftest.py::reset_process_wide_state` misses, though its
docstring claims to reset "every process-global the application keeps":

```
slowapi.errors.RateLimitExceeded: 429: 10 per 1 minute
  tests/test_matchmaking_analysis_lifecycle.py::test_start_route_returns_without_riot_preflight
```

`app/core/http_rate_limit.py:11` builds a module-level `Limiter` whose in-memory
storage survives every pytest session in the process, and its window is wall-clock.
One `limiter.reset()` in the existing autouse fixture fixes it. Worth keeping
regardless of the mutmut verdict — it is the same class of leak the fixture already
exists for, and `pytest-randomly` cannot find it because it is cross-*session*, not
cross-test.

---

## 4. Measured cost

| | `rate_limiter.py` | `signals.py` |
|---|---|---|
| statements | 141 | 159 |
| mutants | 281 | 490 |
| killed / survived | 191 / 90 | 379 / 111 |
| score | 68.0% | 77.3% |
| cold wall clock | **2m07s** | **5m33s** |
| throughput | 5.54 mut/s | 3.74 mut/s |

**Well inside the ~15-minute abort threshold. Per-module mutation testing is cheap
here — call it 2-6 minutes.**

About 2 minutes of each of those is fixed overhead, not mutant execution: a full
coverage run, a full stats run and a clean run, all before the first mutant. A second
invocation with no source change re-ran zero mutants (`0.00 mutations/second`) and
still cost **2m11s**. There is no such thing as a 20-second mutmut run on this suite.

### Extrapolation to whole-repo

`app/` is 134 files / 8,665 statements. At the 2.0-3.1 mutants/statement measured
here that is **~17,000-27,000 mutants**, matching the research doc's estimate.

Naively at 3.7-5.5 mut/s that is 60-120 minutes — **but that number is optimistic and
should not be quoted.** Both modules sampled are the cheap end: pure logic whose
covering tests run in single-digit milliseconds. mutmut runs, per mutant, every test
that touches the mutated function; a mutant in `app/features/auth/service.py` re-runs
the argon2 hashing tests, one in a router re-runs the FastAPI route suites. **Budget
3-6 hours cold for whole-repo, i.e. overnight.** Do not attempt it in the gate.

### One caveat on reading the score

`use_git_change_detection` defaults to `true`, and after the cached re-run above
`mutmut results` reported **118 mutants / 22 survived** rather than the cold run's
490 / 111 — the re-tested subset, not the full picture. Not root-caused. **Only trust
numbers from a cold run** (`rm -rf mutants .mutmut-cache`).

---

## 5. The survivors that name a real gap

Ten survivors were re-applied to the **real** source and the **real** suite run in
full. All ten passed 1253/1253 with the bug in. A control the tool called *killed*
(`x-app-rate-limit` → a mangled header name) failed 4 tests, as it should — the
apparatus is honest in both directions.

### 5a. A blanket `except Exception` makes a whole method unfalsifiable

```
xǁRateLimiterǁ_record_window__mutmut_13
-        assert current is not None
+        assert current is None
```
→ `1253 passed`.

A probe (`raise SystemExit(...)` in that branch, which `except Exception` cannot
catch) proves the branch **is** reached — by exactly one test. So the mutant does not
survive through dead code; it survives because `update_limits`'s
`except Exception: logger.warning(...)` swallows the `AssertionError`, the window is
silently not recorded, and **not one of 1253 tests notices a rate-limit window that
failed to update.** Every mutant that raises inside that call tree survives for the
same reason (`headers.get(None, "")`, `_get_endpoint_key(method)`, and the five
argument-deletion mutants `update_limits__mutmut_32-36`).

**The test that should exist:** `update_limits` with valid headers must leave an
observable window *and* must not have logged `"Failed to parse Riot rate limit
headers"`. A `caplog`-asserting test on that warning turns ~15 survivors into kills at
once. A second probe confirmed the warning never fires during a clean run, so the
assertion costs nothing today.

### 5b. Method windows are never verified from headers; app windows are

```
xǁRateLimiterǁupdate_limits__mutmut_41
-            headers.get("x-method-rate-limit", "")
+            headers.get("XXx-method-rate-limitXX", "")
```
→ `1253 passed`. The **identical** mutation on `x-app-rate-limit` fails 4 tests.

That asymmetry is the finding: the suite proves application-scope windows are built
from response headers and never proves the same for method-scope windows, even though
`RateLimiter`'s class docstring makes per-endpoint method isolation its headline
promise. `update_limits__mutmut_32-36` (deleting each of the five arguments to the
method-window call) all survive, i.e. **the entire second half of `update_limits`
could be deleted** and the suite stays green.

**The test that should exist:** the mirror of the existing app-window test — feed
`X-Method-Rate-Limit`/`-Count`, assert the method window saturates and
`wait_if_needed` sleeps for it, and that a *different* endpoint on the same host does
not.

### 5c. The method verb is not case-normalized anywhere it is observed

```
xǁRateLimiterǁ_get_endpoint_key__mutmut_15
-    return f"{method.upper()}:{...}:{service_key}"
+    return f"{method.lower()}:{...}:{service_key}"
```
→ `1253 passed`.

`.upper()` exists so `get` and `GET` share one method window. Nothing checks it, so a
caller passing a lower-case verb would silently get a second, independent budget.

**The test that should exist:** `_get_endpoint_key(url, "get") == _get_endpoint_key(url, "GET")`.

### 5d. The `matches` / `by-puuid` lookahead is entirely untested

```
xǁRateLimiterǁ_normalize_endpoint_segments__mutmut_14
-        next_segment = segments[index + 1] if index + 1 < len(segments) else None
+        next_segment = segments[index - 1] if index + 1 < len(segments) else None
```
→ `1253 passed`. So do `_redact_count_for_segment__mutmut_18/19` (the
`next_segment != "by-puuid"` guard) and `__mutmut_20` (`return 1` → `2`).

The whole point of that branch is that `/matches/{matchId}` redacts its next segment
while `/matches/by-puuid/{puuid}/ids` does not. No test distinguishes them, so the two
Riot endpoints could collapse into one method window — the exact bug the normalizer
exists to prevent. `__mutmut_4` (`by-riot-id` → redact 3 instead of 2) and
`__mutmut_10` (`by-puuid` → redact 2 instead of 1) survive too.

**The test that should exist:** one parametrized table of real Riot paths → expected
normalized key, including both `matches` shapes.

### 5e. The burst spacing constant is asserted by nothing

```
xǁRateLimiterǁ__init____mutmut_4
-        self.request_spacing = 0.05
+        self.request_spacing = 1.05
```
→ `1253 passed`. A 21× change to the requests-per-second ceiling is invisible.

**The test that should exist:** two back-to-back `wait_if_needed` calls with a mocked
clock must record a sleep of `0.05 - elapsed`. The suite already has the
`recorded_sleeps` fixture for it.

### 5f. `signals.py`: a sign flip in the core statistic

```
x_evaluate_a3__mutmut_30
-    value = mean(scores) - mean(inputs.composite_baseline)
+    value = mean(scores) + mean(inputs.composite_baseline)

x_evaluate_b1__mutmut_15
-    composite_delta = mean(inputs.composite_recent) - mean(inputs.composite_baseline)
+    composite_delta = mean(inputs.composite_recent) + mean(inputs.composite_baseline)
```
→ both `1253 passed`.

The smurf-boost detector's entire output is *recent minus baseline, in standardized
units*. Adding the baseline instead of subtracting it is not a subtle boundary case —
it inverts the meaning of the signal — and the suite cannot tell. The tests fix inputs
so that the two means are arranged such that both expressions land the same side of
the threshold.

**The test that should exist:** for each evaluator, one case where recent < baseline
asserting a *negative* value and no trigger. Currently every fixture makes recent
above baseline.

### 5g. `signals.py`: no evaluator has an at-threshold case

`>=` → `>` survives on **every** trigger in the file: `a1__22`, `a2__25`, `a3__52`,
`a4__35/36`, `b1__27`, `b2__41/58`, `b3__27/28/29`, `b4__29/30/32/38/39`. Verified:
`triggered = value >= threshold` → `>` leaves 1253 green.

A threshold constant is a product decision; whether it is inclusive is part of it.
Sixteen survivors, one mechanical fix.

**The test that should exist:** one `value == threshold` case per evaluator asserting
`triggered is True`.

### 5h. `signals.py`: `strict=True` proven decorative

```
x__novel_scores__mutmut_7
-        zip(inputs.recent, inputs.composite_recent, strict=True)
+        zip(inputs.recent, inputs.composite_recent, strict=False)
```
→ `1253 passed`. No test ever passes mismatched-length inputs, so the guard that
exists to catch exactly that has never been shown to fire.

---

## 6. Equivalent-mutant noise: ~51%

Rule used: a survivor is **noise** if it only changes a human-readable message, a log
payload, or an internal opaque token — no behavioural contract moves.

| | survivors | noise | actionable |
|---|---|---|---|
| `rate_limiter.py` | 90 | 36 (40%) | 54 |
| `signals.py` | 111 | 67 (60%) | 44 |
| **total** | **201** | **103 (51%)** | **98** |

The noise is highly patterned and skimmable in about two minutes:

- **Every string literal yields three mutants** — `"foo"` → `"XXfooXX"`, `"FOO"`,
  `"foo"`-cased. On `signals.py`, whose output *is* prose explanations, that alone is
  ~40 survivors. Under this repo's own no-assert-on-copy standard these are
  unkillable by design.
- **Every `logger.info(...)` argument yields ~4 mutants** (→`None`, deleted, three
  case variants). `_sleep_if_windows_saturated` contributes 11 survivors that are
  purely its log call.
- **Falsy-default equivalences.** `headers.get(k, "")` → `None`, → `"XXXX"`, → omitted:
  12 survivors in `update_limits`, all genuinely equivalent because
  `_parse_rate_headers` short-circuits on falsy *and* on unparseable input alike.
- **Case-flipped header names** (`"X-APP-RATE-LIMIT"`): 4 survivors, genuinely
  equivalent because `httpx.Headers` is case-insensitive — as `update_limits`'
  docstring already says.

So the real cost of reading a module's output is ~100 diffs, half of them
recognisable as noise at a glance. That is a tolerable half-hour for a module you
actually suspect, and an intolerable one for 27,000 mutants.

---

## 7. Reproduce

```bash
cd <worktree>/backend
export UV_PROJECT_ENVIRONMENT=/tmp/lga-venv-mutmut
export PATH="/home/pi/actions-runner-media-monitoring/_work/_tool/uv/0.11.31/aarch64:$PATH"
uv sync --locked --all-groups
uv pip install --python /tmp/lga-venv-mutmut/bin/python "mutmut>=3.7.0"

# 1. the one meta-test that reaches above the backend root
ln -s ../frontend frontend        # or: pytest_add_cli_args = ["--ignore=tests/test_frontend_api_paths.py"]

# 2. [tool.mutmut] in pyproject.toml — see §2. set only_mutate to your target.

# 3. cold run (the cache lies; see §4)
rm -rf mutants .mutmut-cache
POSTGRES_DB=league_analysis_test POSTGRES_USER=league_analysis_test \
POSTGRES_PASSWORD=league-analysis-test-password POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5432 \
DEBUG=false JWT_SECRET_KEY=league-analysis-test-jwt-secret-32-characters ENVIRONMENT=test \
  /tmp/lga-venv-mutmut/bin/mutmut run --max-children 4

/tmp/lga-venv-mutmut/bin/mutmut results
/tmp/lga-venv-mutmut/bin/mutmut show <mutant-name>

# 4. clean up — none of this belongs in the tree
rm -rf mutants .mutmut-cache frontend
```

`mutants/` and `.mutmut-cache` are **not** in `.gitignore`. Add them if this is ever
run twice by the same person.

---

## 8. What to do with this

1. **Do not add mutmut to `pyproject.toml`.** Ad-hoc install, per-module, on demand.
   It is a tool for the question "do I actually believe these tests?" about one
   module, asked by a human who already suspects the answer.
2. **Take the free wins now**, none of which need mutmut to keep working: the
   `caplog` assertion on `update_limits`' swallowed warning (§5a, ~15 mutants), the
   method-window mirror test (§5b), the at-threshold cases in `signals.py`
   (§5g, 16 mutants), and the negative-delta cases (§5f).
3. **Land the `limiter.reset()` fix** (§3) on its own merits.
4. **Pitfall worth recording:** a bare `except Exception` around a call tree turns
   every bug inside it into a log line, and no gate in this repo catches an
   assertion that never runs. §5a is the proof; mutation testing is currently the
   only thing that finds it.
