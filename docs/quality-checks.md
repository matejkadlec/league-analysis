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
./deploy/container-qa.sh   # Production image build and runtime validation
```

The focused modes shorten implementation feedback. They never substitute for
the complete gate before publication. `test.sh` resolves its own worktree root,
so it is safe to call from the main checkout or any worktree.

## Decisions

- **Production packaging is verified by building it.** `deploy/container-qa.sh`
  builds both production images, runs the Compose migration service,
  health-checks the stack, and performs a real dump and restore. It is
  deliberately outside `./test.sh`, which must stay fast enough to run during
  implementation.
- **The Playwright suite is outside the gate.** `cd frontend && npm run test:e2e`
  needs `npx playwright install chromium` once per pinned browser version. It
  stays separate until that provisioning is part of the deterministic CI
  environment. It uses intercepted fixtures and never calls Riot or a database.
- **Dependency advisories are GitHub's job, not a CI job.** Advisory databases
  change independently of a commit, so an advisory check is not reproducible
  and cannot gate anything deterministically. Dependabot alerts and security
  updates (free on private repositories) watch the same lockfiles
  asynchronously and open fix pull requests; the bespoke differential CI audit
  they replaced was removed in 2026-08.
- **Bandit excludes B104 and nothing else.** The direct local entry point binds
  WSL and LAN interfaces on purpose. Production process and network hardening
  is LGA-10.
- **Pre-commit stays static and lockfile-backed.** Local backend hooks use
  `uv run --locked` and `always_run`, so they cannot rewrite `uv.lock` mid-
  commit or skip a deletion-only change. They do not run pytest (needs the
  test database) or live CVE scans (advisory databases are not deterministic;
  Dependabot owns that).
- **Xenon is a blocking B-rank gate.** Every block under `backend/app` must
  stay at rank B or better (CC <= 10). It runs at commit time and in
  `./test.sh -b`.
- **Tests never need a real Riot API key, network access, or a real database
  password.** CI and local runs pass explicit safe test-only values.
- **CI always runs the complete gate.** `./test.sh -r` exists for local
  documentation-only feedback, but CI does not try to detect that case: a
  required check that skips itself has to be wired through every step, and the
  minutes saved are not worth that. The deploy workflow does skip
  documentation, through `paths-ignore`, because it is not a required check.
- **Deploy runs are serialised, never cancelled.** The deploy workflow uses
  `cancel-in-progress: false` on the pi5ram16 runner, because interrupting a
  host mutation is less safe than queueing it. Quality runs are cancelled when
  superseded. Deployment does not repeat the quality gate.
- **Dependabot pull requests are never auto-merged and never receive real
  secrets.** They follow the normal workflow: rebase on current `master`, run
  the complete gate, wait for required checks and review, merge through the
  protected path.

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
