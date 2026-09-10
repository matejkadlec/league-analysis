# Quality Checks and Continuous Integration

> **Authority:** Quality entry points and the decisions behind them.
>
> **Maintenance:** Update when a decision recorded here changes. Do not
> restate what `test.sh`, `.pre-commit-config.yaml`, `.github/workflows/` or
> `.github/dependabot.yml` already say; read those for the current contents of
> each gate.

## Entry points

```bash
./test.sh             # Complete gate; mandatory before every pull request
./test.sh -f          # Repository plus frontend
./test.sh -b          # Repository plus backend
./test.sh -r          # Repository only, for documentation-only changes
```

The focused modes shorten implementation feedback. They never substitute for
the complete gate before publication. `test.sh` resolves its own worktree root,
so it is safe to call from the main checkout or any worktree.

## Decisions

- **The Playwright suite is inside the gate, and runs against the production
  build.** It used to sit outside because provisioning a pinned browser was not
  deterministic; `gate.Dockerfile` now installs the Chromium matching the
  `@playwright/test` pin, which removed that reason. It runs after the build
  step because what it starts is that build. Against `next dev` the suite hit a
  hydration mismatch that production never sees: compiling on first visit
  stretches the initial load, and once the specs stopped letting icon requests
  reach the network, pages began hydrating before the payload had settled, so
  React discarded the server HTML and re-rendered — not a state worth asserting
  on. It uses intercepted fixtures and reaches neither Riot nor a database.
- **The frontend linter is oxlint, and its house rules are the point.** ESLint
  ran the same checks in roughly eight seconds; oxlint runs them in under one,
  type-aware rules included, which moves linting from a CI step to something
  that runs on save. The move cost one native rule — oxlint has no
  `no-restricted-syntax` and will not get one — so the selector lists the
  session guards depend on moved into a JS plugin. That plugin directory is now
  where this project's non-obvious invariants get enforced rather than
  reviewed; each rule states what it is for in its own report message. The pin
  is exact, like Ruff and Pyright: a linter release
  that adds a rule must not tighten the gate on an unrelated commit.
- **A lint rule's test is a fixture, not a unit test.** Each house rule has a
  fixture where the shapes it must flag carry a disable directive and the
  shapes it must not carry none. The gate runs with
  `--report-unused-disable-directives-severity=error`, so a rule that stops
  matching leaves an unused directive and fails, and one that over-matches
  reports on an accepted case and fails. One file proves both directions and
  fails on a regression rather than on a rewrite.
- **Dependency advisories are GitHub's job, not a CI job.** Advisory databases
  change independently of a commit, so an advisory check is not reproducible
  and cannot gate anything deterministically. Dependabot alerts and security
  updates (free on private repositories) watch the same lockfiles
  asynchronously and open fix pull requests; the bespoke differential CI audit
  they replaced was removed in 2026-08.
- **Bandit excludes B104 and nothing else.** The direct local entry point binds
  WSL and LAN interfaces on purpose.
- **Pre-commit stays static and lockfile-backed.** Local backend hooks use
  `uv run --locked` and `always_run`, so they cannot rewrite `uv.lock` mid-
  commit or skip a deletion-only change. They do not run pytest (needs the
  test database) or live CVE scans (advisory databases are not deterministic;
  Dependabot owns that).
- **The hooks that need no hook environment also run in the gate.** Secret
  scanning and the `repo: local` architecture rules were enforced only by
  `.githooks/pre-commit`, which each developer has to opt into, so a commit
  from a machine without it reached `master` unchecked. `./test.sh` runs both
  in its repository scope: gitleaks from the pinned binary in the gate image,
  and the local hooks through pre-commit against a generated configuration
  that names nothing else. The remote hooks stay commit-time only, because
  pre-commit installs their environments over the network while it runs, and
  the gate installs nothing.
- **Xenon is a blocking B-rank gate.** Every block under `backend/app` must
  stay at rank B or better (CC <= 10). It runs at commit time and in
  `./test.sh -b`.
- **Tests never need a real Riot API key, network access, or a real database
  password.** CI and local runs pass explicit safe test-only values.
- **Pull-request checks run on disposable GitHub-hosted ARM64 runners.**
  The disposable test container runs without application credentials.
  Remove repository access to self-hosted runners before changing visibility;
  a contributor can modify workflow files in their own pull request.
- **CI always runs the complete gate.** Documentation-only local feedback may
  use `./test.sh -r`; publication does not trigger deployment.
- **Dependabot pull requests are never auto-merged and never receive real
  secrets.** They follow the normal workflow: rebase on current `master`, run
  the complete gate, wait for required checks and review, merge through the
  protected path.

## What makes a test worth keeping

Coverage measures execution, not verification. A test can run a line and prove
nothing about it, and a generator writing tests to a coverage number optimises
for exactly that gap — so the standard below is the thing being enforced, and
the gate steps after it are only the mechanical part anyone could automate.

**The test is: does the assertion state a rule the code must satisfy, or does
it mirror the code's current value?** `<ProtectedRoute requireAdmin>` on the
admin page is a rule; `padding: 12px` is a value. Two families are deleted on
sight:

- **Tautological** — the expectation is re-derived from the implementation, so
  no change to the data can break it.
- **Source-echo** — the test reads a file and asserts it contains a literal
  copied out of that same file. It fails only when someone edits the file, and
  the fix is always to update the copy.

Deliberately *not* on that list, because all three state rules: whole-tree
policy scans with allowlists, cross-boundary alignment checks (frontend zod
against backend Pydantic), and assertions on runtime artifacts — compiled SQL,
built URLs, rendered DOM.

**Falsifiability is proven by mutation, never by reading.** Reading shows only
that an assertion passes today. Back up the production file, apply the
regression the test claims to guard, run that one test, restore. A test that
survives its own mutation is dead; one that fails is load-bearing. This is not
a formality — it has repeatedly reversed the verdict in both directions, and
## What the gate enforces mechanically

Each of these exists because a specific shape of test survived review.

- **`house/meaningful-tests`** (oxlint, `tests/**` and `e2e/**`) — a test whose
  every assertion is a mock-call matcher, and a bare `toThrow()`, which every
  error satisfies including the `TypeError` from the bug.
- **`house/no-fire-event-click`** — `fireEvent` for actions a user performs.
  `fireEvent` dispatches one event straight at the node, so it passes on a
  control that is disabled, `display:none`, or under `pointer-events: none`;
  `user-event` performs the real sequence and checks reachability on the way.
  Proven here: a test drove a button production renders `hidden`.
- **`expect.requireAssertions`** and `scripts/check_tests.py` — the runtime and
  AST halves of "this test asserts something". The Python script is the
  backend's counterpart to `meaningful-tests`; nothing else in the backend gate
  asks whether a test can fail.
- **Ruff `PT`** — `pytest.raises(ValueError)` with no `match=` is the shape a
  generator reaches for on every error path, and it passes on the `ValueError`
  a bug raises as readily as the one the test names. `PT018` splits
  `assert a and b`, where one half can rot unnoticed.
- **`strict_xfail`** — an `xfail` that starts passing is otherwise silent.
- **Randomised order** (`sequence.shuffle`) — an order-dependent test passes
  only because another test ran first, and nothing else can see one.

## Stable check names

The `master` ruleset requires one check context by exact name:

```text
Deterministic full-project gate
```

Renaming the job breaks the ruleset and needs an administrator to update it.
See [`github-governance.md`](github-governance.md).

## Result reporting

A passing local gate proves only local validation. After publication, report
GitHub checks as passed only from current remote workflow evidence.
