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
- **The live dependency audit is GitHub-only.** Advisory databases change
  independently of a commit, so its result is not reproducible locally and
  cannot gate a local run.
- **The audit blocks new findings always, and inherited findings only when
  production dependency declarations change.** An advisory published against an
  existing dependency must not turn unrelated pull requests permanently red.
  `scripts/dependency-audit.sh <base-revision>` audits base and candidate locks
  against one advisory snapshot. `test.sh` regression-tests this policy offline.
- **Bandit excludes B104 and nothing else.** The direct local entry point binds
  WSL and LAN interfaces on purpose. Production process and network hardening
  is LGA-10.
- **Tests never need a real Riot API key, network access, or a real database
  password.** CI and local runs pass explicit safe test-only values.
- **A documentation-only change runs the repository gate only.**
  `scripts/detect-docs-only-change.sh` makes that call in CI.
- **Deploy runs are serialised, never cancelled.** The deploy workflow uses
  `cancel-in-progress: false` on the pi5ram16 runner, because interrupting a
  host mutation is less safe than queueing it. Quality runs are cancelled when
  superseded. Deployment does not repeat the quality gate.
- **Dependabot pull requests are never auto-merged and never receive real
  secrets.** They follow the normal workflow: rebase on current `master`, run
  the complete gate, wait for required checks and review, merge through the
  protected path.

## Stable check names

The `master` ruleset requires two check contexts by exact name:

```text
Deterministic full-project gate
Live production dependency audit
```

Renaming either job breaks the ruleset and needs an administrator to update it.
See [`github-governance.md`](github-governance.md).

## Result reporting

A passing local gate proves only local validation. After publication, report
GitHub checks as passed only from current remote workflow evidence.
