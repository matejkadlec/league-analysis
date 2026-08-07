# Quality Checks and Continuous Integration

> **Authority:** Local quality entry points, deterministic installation
> boundaries, automated test scope, tool pins, and GitHub Actions behavior.
>
> **Maintenance:** Update whenever a gate command, runtime/tool pin, workflow
> trigger, stable check name, test layer, or local-versus-GitHub boundary
> changes.

## Authoritative entry points

Run commands from the repository root:

```bash
./test.sh             # Complete repository + frontend + backend gate
./test.sh -f          # Repository + frontend feedback gate
./test.sh -b          # Repository + backend feedback gate
./scripts/ci.sh       # Portable CI wrapper used by GitHub Actions
```

`./test.sh` is the mandatory pre-pull-request command. The focused modes shorten
implementation feedback but do not replace the complete gate before
publication. Every step is named and fail-fast. The script resolves its own
worktree root, so it is safe to call from the main checkout, another directory,
or a Git worktree.

Every invocation enters `scripts/guard-git-worktree-test.sh` exactly once before
running a check. The guard verifies before and after the child process that the
repository is still a non-bare worktree, its worktree/common Git directory
identity is unchanged, and protected local/worktree configuration is unchanged.
Protected keys include `core.bare`, `core.worktree`, `core.gitdir`,
`core.hooksPath`, `extensions.worktreeConfig`, and the
`league-analysis.trustedhookspath` ownership marker. Signals terminate the
guarded process group, integrity failures fail closed with before/after
diagnostics, and an ordinary test failure keeps its original status. The
`LGA_GIT_WORKTREE_GUARD_ACTIVE` variable is an internal recursion marker; do not
set it to bypass the guard.

Frontend runs preserve the pre-existing tracked state of
`frontend/next-env.d.ts`; ignored build/cache outputs stay outside the diff.

## Deterministic dependencies and tools

- Node 26.5.1 is pinned by `.nvmrc`; `scripts/use-project-node.sh` accepts only
  that exact runtime and may select it through NVM.
- npm 12.0.2 is recorded in `packageManager`/`devEngines`, installed explicitly
  in CI, and enforced with exact Node/npm engines. Exact reviewed install
  scripts are allowlisted and any new unreviewed installer fails.
- Python is pinned by `.python-version` and constrained by
  `backend/pyproject.toml`.
- Frontend dependencies install with `npm ci` from `package-lock.json`.
- Backend and development dependencies install with
  `uv sync --frozen --all-groups` from `uv.lock`.
- CI pins uv 0.12.1 through the immutable setup-uv 9.0.0 action.
- ShellCheck 0.11.0 and actionlint 1.7.12 installers verify both release archive
  and extracted binary SHA-256 checksums on Linux x86-64 and ARM64.
- GitHub third-party actions are pinned by complete commit SHA with a readable
  release comment. Checkout credentials are not persisted.

## Gate contents

### Repository and workflow checks

All modes run:

- `git diff --check`;
- tracked JSON parsing, merge-marker detection, and sensitive-filename hygiene;
- ShellCheck over every tracked shell script;
- regression checks for the ShellCheck installer/runner, Node selector, CI
  entry-point coupling, and the LGA-23 card-configuration contract;
- Flow 1 policy regressions for expected batch scale, undersized-batch reasons,
  bounded independent PRs, worktree defaults, and final handoff behavior;
- trusted-hook, local `.env` provisioning, primary/linked worktree identity,
  signal handling, and worktree-integrity guard regressions;
- actionlint syntax and expression validation;
- repository workflow policy checks for immutable action pins, version
  comments, `contents: read`, credential-safe checkout, concurrency
  cancellation, required triggers, and job timeouts.
- tracked `master` branch-ruleset desired state, including its exact stable
  required-check contexts, GitHub Actions integration binding, and zero-review
  workflow policy. The deterministic
  configuration regression is local; the separate live audit remains read-only
  and requires authenticated GitHub API access.
- Dependabot v2 configuration coverage for every current package ecosystem,
  manifest directory, update limit, local weekly schedule, labels, and the
  minor/patch-only version-update group. The validator intentionally detects
  Dockerfiles, so LGA-10 must add the matching Docker update entry when it
  introduces deployment artifacts.

The complete/backend gate also validates `.pre-commit-config.yaml` with the
locked pre-commit installation.

### Frontend checks

- exact Node selection;
- `npm ci`;
- ESLint 10 with zero warnings; `@eslint/compat` adapts legacy Next.js plugin
  rule APIs without suppressing any configured lint rules;
- `tsc --noEmit`;
- deterministic Vitest regressions for player search validation, platform
  presentation, rank-style mapping, and Top Champions pagination boundaries;
- Next.js production build.

The separate `cd frontend && npm run test:e2e` Playwright suite verifies the
Top Champions browser interaction against intercepted deterministic API
fixtures. It requires `npx playwright install chromium` once for the pinned
browser version, but never calls a real Riot endpoint or a local database. It
is intentionally separate from `./test.sh` until the browser-installation
provisioning is part of the deterministic CI environment.

### Backend checks

- `uv sync --frozen --all-groups`;
- Alembic clean-database validation that creates and removes an isolated
  PostgreSQL database, verifies all schemas/tables/enums/triggers, and exercises
  async application access plus the user-settings trigger;
- pytest coverage for authentication/password and active/admin authorization,
  settings schemas, Riot HTTP/rate-limit boundaries, job queue/error behavior,
  core validation, and match/player transformations;
- Ruff lint and format verification for backend and Python quality tooling;
- Pyright with the configured zero-error/zero-warning policy;
- Bandit over application code at the reviewed medium-severity,
  medium-confidence threshold. B104 is the sole reviewed exclusion because the
  direct local entry point intentionally binds WSL/LAN interfaces; production
  process/network hardening remains part of LGA-10.

Tests receive explicit safe test-only database/JWT values and never require a
real Riot API key or network access.

## Pre-commit, local PR, and GitHub boundaries

| Boundary | Required checks |
| --- | --- |
| Before commit | Configured pre-commit hooks: hygiene/format hooks, Ruff, frontend ESLint, and frontend TypeScript when matching files changed |
| During implementation | `./test.sh -f` or `./test.sh -b` for the affected domain |
| Before pull request | Complete `./test.sh`; never substitute focused output |
| GitHub `Quality Checks` | Stable jobs `Deterministic full-project gate` and `Live production dependency audit` |

The live audit is intentionally GitHub-only because advisory databases change
independently of a commit. `scripts/dependency-audit.sh <base-revision>` audits
base and candidate locks with the same advisory snapshot. It blocks newly
introduced findings, and it blocks inherited findings whenever production
dependency declarations change; inherited findings do not make unrelated
changes permanently red. The deterministic gate regression-tests this policy.
Developers may run the live comparison manually when network access is
available, but its output is not part of the deterministic local gate.

## Dependabot review policy

`.github/dependabot.yml` checks the current frontend npm, backend uv, and
GitHub Actions manifests weekly on Monday morning in `Europe/Prague`. A
maximum of three frontend/backend version-update pull requests and two Actions
version-update pull requests may be open at once. The `minor-and-patch` group
reduces routine version-update noise while keeping major version updates
separate. Security updates are not grouped by that rule and GitHub does not
subject them to the version-update open-pull-request limit.

Dependabot pull requests target `master` and follow the normal repository
workflow: inspect the manifest and lockfile changes, rebase when current
`master` moves, run the complete `./test.sh` gate, wait for the required GitHub
checks and review, then merge only through the protected pull-request path.
Do not auto-merge dependency changes or provide Dependabot with real secrets.
No Docker update block exists yet because LGA-10 has not added Dockerfiles or a
Compose definition; that ticket must extend this configuration in the same
change.

## GitHub Actions behavior

`.github/workflows/quality-checks.yml` runs for pull requests to `master`,
pushes to `master`, manual dispatch, and the LGA-14 bootstrap branch so the first
workflow pull request can validate itself before the definition exists on
`master`. Superseded runs are cancelled. Workflow permissions are limited to
`contents: read`.

The deterministic job provisions PostgreSQL 18.4 and passes only safe CI values.
Because the workflow calls `scripts/ci.sh`, which calls the guarded `./test.sh`,
the Flow 1 and worktree suites run in GitHub Actions without a second workflow
entry point. The full backend gate validates the initial Alembic baseline in a
fresh isolated database. CI additionally sets `LGA_VALIDATE_MIGRATIONS=1` and
applies `backend/scripts/migrate.py upgrade head` to its clean PostgreSQL 18.4
service database through the same advisory-lock path. Docker build/hardening
checks remain conditional on LGA-10 adding deployment artifacts. Dependabot
configuration and its dedicated regression validator remain owned by LGA-15.

The user must supply any current Codex Cloud Setup/Maintenance scripts before
they can be adapted. Never request or copy a complete `.env`; Cloud should use
the same safe test values as CI and configure real secrets only through its
settings.

## Result reporting

A passing local gate proves only local validation. After publication, report
GitHub checks as passed only from current remote workflow evidence. The `master`
ruleset requires the two stable check contexts; run
`python3 scripts/verify-github-ruleset.py` after an authorized GitHub
administration change to verify that live configuration remains aligned.
