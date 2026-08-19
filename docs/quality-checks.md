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
- **The gate runs on pi5ram16, not on GitHub's hardware.** Actions minutes are
  billed only for GitHub-hosted runners -- self-hosted usage is free -- and
  this account's included minutes were nearly spent while the runner that
  deploys sat idle between merges. The Pi is also the more honest host: it is
  aarch64, so `deploy/container-qa.sh` now builds and boots the architecture
  production actually serves instead of amd64 images that never ship. The
  costs are real and accepted: four cores rather than eight, and one runner
  shared with the deploy workflow, so a merge queues behind a gate already in
  flight. The workflow prunes dangling images and week-old build cache
  afterwards, because the CI host is the production host -- never volumes,
  which is where production's database lives.
- **CI always runs the complete gate.** `./test.sh -r` exists for local
  documentation-only feedback, but CI does not try to detect that case: a
  required check that skips itself has to be wired through every step, and
  that complexity buys nothing now that the runner costs no minutes. The
  deploy workflow does skip documentation, through `paths-ignore`, because it
  is not a required check.
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
