# Guard Quality Loop

Tests here are known to pass while guarding nothing. Two measured cases, both
recorded in `frontend/vitest.config.mts`: reverting all four `app/` shells to
`return null` left the suite green and the coverage summary byte-identical, and
deleting eleven session test files — 40% of the suite — still cleared every
floor. Coverage says a line ran. It never says an assertion would have noticed
if that line were wrong.

This loop attacks the source and keeps whatever the tests failed to catch.

## Card

**When:** on demand, resumable. Any session, any number of iterations, until
the ledger's target list is exhausted.

**See:** `.claude/loops/guard-quality-ledger.md` for what previous runs already
covered — never re-attack a file already marked `killed` or `accepted`. Then
the current coverage report for the next target's real numbers.

**Do:** one target file per iteration.

- Target is **0%-covered**: coverage is already the finding — do not mutate.
  Decide one of: write the smallest real test, delete the code if nothing
  reaches it, or record `accepted` with the reason.
- Target is **covered**: apply 2–3 mutations (invert a conditional, empty a
  branch body, early-return a function, drop an await, off-by-one a boundary).
  Run the scoped check after each.
  - Mutation **dies** (test goes red) → the guard is real, move on.
  - Mutation **survives** (suite stays green) → a hole. Pick one of three
    outcomes, never a fourth: kill it with the smallest test that fails
    against the mutation, delete the code as dead, or record `accepted` with
    the reason. Do not invent a test that asserts implementation detail purely
    to kill a mutant — an accepted survivor is a legitimate result.
  - Mutation reveals behaviour that is **actually wrong** rather than merely
    untested — that is a bug. Fix it on a branch; no ticket needed, per
    `CLAUDE.md`.

Out of scope: broad refactors, renames, dependency changes, new abstractions,
anything under `docs/`, and any Jira transition.

**Check:** the scoped command for the stack, verified 2026-08-19 at ~1s and
~1.7s respectively:

```bash
# frontend, from frontend/ — the source line is not optional, node arrives
# via fnm and is absent from a fresh shell's PATH
source ../scripts/use-project-node.sh
npx vitest run <paths> --reporter=dot

# backend, from backend/ — full collection, filtered execution
env POSTGRES_DB=league_analysis_test POSTGRES_USER=league_analysis_test \
    POSTGRES_PASSWORD=league-analysis-test-password \
    POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5432 \
  uv run pytest tests -q --no-cov -k "<pattern>"
```

A `-k` run that fails on a database connection means that test class is
gate-only and needs `compose.gate.yml`. That is not a surviving mutation —
revert and either run it under the gate or record the file as deferred.

A killing test must be shown red against the mutation and green against real
code. Claiming either without running it defeats the entire loop. Run the full
`./test.sh -f` / `-b` once per PR, not once per mutation.

**Stop:**

- Pass: ledger target list exhausted, or the batch is merged.
- Non-pass: three consecutive files yield zero survivors (the seam is
  genuinely well guarded — say so and stop), a survivor needs a product
  decision, or two attempts at a killing test fail without new evidence.

**Leave:** ledger rows for every file touched, the PR, and any `accepted`
reasons. A run that finds nothing still writes rows — "attacked, all mutations
died" is the result that stops the next run repeating the work.

**Owner:** this file, driven manually.
**Primitives:** primary=skill-shaped playbook; support=state (ledger);
why=the loop spans sessions and its whole value is not re-attacking covered
ground.

## Traps found while building this

- **`pytest tests/test_x.py` alone fails.** Single-file collection misses the
  SQLAlchemy model registry and dies on `failed to locate a name
  ('MatchParticipant')`. Always collect the whole `tests` directory and filter
  with `-k`. A "failure" from a single-file run is an artefact, not a survivor.
- **Restore discipline.** Mutate → run → **revert the mutation** → write the
  test → confirm red/green. `git status` must show only test files (plus any
  real bug fix) before committing. A mutation reaching a commit is the one
  unrecoverable way this loop can hurt the repo.
- **Mutating a 0%-covered line proves nothing** — it survives by definition.
  That is why the two target classes are handled differently.
- **Aim at the uncovered lines first.** `--coverage.reporter=text` prints an
  `Uncovered Line #s` column, and on iteration 1 it named both survivors and
  neither of the three that died. Mutating a covered line mostly confirms the
  guard works; two minutes reading that column beats guessing. It is a
  shortlist, not the whole job — a covered line with a weak assertion still
  hides, which is the case only mutation finds.

## Merge contract

Batch survivors by area into small PRs — auth, matches, jobs, settings — not
one monster. Review at medium, then merge.
Sending the loop prompt is the endorsement of this contract; nothing else
needs asking mid-run.

## Seeding the target list

Regenerate the numbers rather than trusting the ones below to stay true:

```bash
cd frontend && source ../scripts/use-project-node.sh
npx vitest run --coverage   # writes coverage/coverage-summary.json
```

Ranked by risk, highest first: auth and token paths, `proxy.ts`, then whatever
the report shows. Backend's `fail_under = 47` says the same weakness lives
there — do not leave it as a frontend-only loop.
