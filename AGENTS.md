# League Analysis - AI Agent Guide

> **Scope:** Repository-wide instructions. More specific `AGENTS.md` files add
> subtree guidance but may not weaken these rules.
>
> **Maintenance:** Update this file when repository identity, mandatory workflow,
> top-level structure, or repository-wide safety rules change. Keep detailed
> architecture and operating notes in [`docs/`](docs/README.md).

## Repository and Project Identity (Mandatory)

- Canonical GitHub repository: `matejkadlec/league-analysis`
- Default branch: `master`
- Canonical Jira project: `League Analysis`
- Jira project key: `LGA`
- Jira board: `34`
- Continuous QA issue: `LGA-1`

For work originating from this repository:

- Always scope Jira searches, issue creation, updates, transitions, and comments
  to project `League Analysis` / key `LGA`.
- Never mutate another Jira project unless the user explicitly requests a
  cross-project action.
- Always target GitHub repository `matejkadlec/league-analysis`.
- Never mutate another GitHub repository unless the user explicitly requests a
  cross-repository action.
- Before every Jira write, verify the project key or issue-key prefix.
- Before every GitHub write, verify the exact repository target and current
  `origin` remote.
- Treat any target mismatch as a blocker. Never guess the intended project or
  repository from the authenticated account.

Canonical repository URL:
<https://github.com/matejkadlec/league-analysis>.

## Mandatory Development Workflow

[`docs/ai-development-flow.md`](docs/ai-development-flow.md) is authoritative for
Jira intake, batching, QA classification, branches/worktrees, pull requests,
remediation, owner handoff, and the `flow1`, `flow2`, `qa1`, and `qa2`
shortcuts. Read it before selecting or publishing task work.

Non-negotiable summary:

- Use the verified Jira lifecycle:
  `TO DO` -> `NEXT` -> `IN PROGRESS` -> optional `PENDING USER QA` ->
  `PENDING CR` -> `DONE`.
- Inspect the active sprint, queues, in-flight Jira work, open/draft pull
  requests, branches, worktrees, current branch, and dirty changes before
  autonomous selection. Do not force overlapping work.
- Select the largest safe coherent batch. Planning scale is approximately 3
  large, 5 medium, or 10 small tickets, or a comparable mixed batch. Record a
  concrete conflict, dependency, uncertainty, owner boundary, or lack of
  compatible candidates when the selected batch is materially smaller.
- Classify intentional visual changes as User QA. Documentation, backend,
  schema, infrastructure, security, tests, refactors, and non-visual frontend
  logic are AI-only unless mixed with inseparable visual scope.
- Do not push task work directly to `master` unless the user explicitly grants
  that exception. Normal task work starts from current `origin/master`.
- New `flow1` work uses a dedicated linked worktree by default. Continuing an
  existing owning branch/worktree is allowed; using the primary checkout needs
  a concrete exceptional reason recorded in the batch ledger.
- An AI-created pull request is ready for review, not draft. Prefer one
  coherent multi-ticket PR. One preselected invocation may publish up to two
  independent ready pull requests. At most two independently selected batches
  may be pending or unmerged at once, counting both `PENDING CR` and `PENDING
  USER QA`. Each published PR becomes owner-managed immediately: do not poll,
  review, repair, merge, or deploy it.
  Continue only with independent batches recorded during intake, then provide
  one final ticket-to-PR handoff and stop.
- Owner-managed review and merge are workflow policy, not an identity control
  supplied by the zero-approval ruleset. Agents must not merge without explicit
  owner authorization.
- Move an issue to `DONE` only after its pull request is merged into `master`.
- Never request secrets or complete environment files in chat or Jira.

## Repository Map

| Area | Authority |
| --- | --- |
| Documentation map and ownership | [`docs/README.md`](docs/README.md) |
| Project structure, stack, and commands | [`docs/project-overview.md`](docs/project-overview.md) |
| Quality gates and GitHub Actions | [`docs/quality-checks.md`](docs/quality-checks.md) |
| Production containers and Pi deployment | [`docs/deployment.md`](docs/deployment.md) |
| AI/Jira/GitHub development lifecycle | [`docs/ai-development-flow.md`](docs/ai-development-flow.md) |
| GitHub branch governance | [`docs/github-governance.md`](docs/github-governance.md) |
| Backend conventions | [`backend/AGENTS.md`](backend/AGENTS.md) |
| Frontend conventions | [`frontend/AGENTS.md`](frontend/AGENTS.md) |
| Database schema revisions | [`backend/alembic/versions/`](backend/alembic/versions/) |
| Database explanation and change workflow | [`docs/database.md`](docs/database.md) |
| Riot API integration | [`docs/riot-api.md`](docs/riot-api.md) |
| Background jobs and scheduler | [`docs/jobs.md`](docs/jobs.md) |
| Cookie/storage consent | [`docs/cookie-consent-compliance.md`](docs/cookie-consent-compliance.md) |

Read the nearest applicable `AGENTS.md` before editing a subtree. Nested guides
contain local architecture, conventions, and gotchas only. Documentation records
durable system decisions; Jira records planned and in-flight work.

## Quick Start

The local environment is WSL with PostgreSQL 18. Configuration is loaded from
the repository-root `.env`; keep its values secret.

Install or refresh the repository's trusted local hooks after cloning or after
hook changes:

```bash
./scripts/install-git-hooks.sh
```

The installed post-checkout snapshot may provision only the ignored root
`.env` from the primary checkout into a new linked worktree. It never prints
contents or overwrites an existing file or symlink, and provisioned copies use
mode `600`. See [`docs/project-overview.md`](docs/project-overview.md#git-hooks-and-worktrees).

```bash
./run.sh                         # Backend 8000 + frontend 3000
./run.sh 3001 8001              # Custom frontend/backend ports
./run.sh --help
tail -50 logs/backend.log
tail -50 logs/frontend.log
```

`./deploy/container-qa.sh` is the explicit Docker packaging/health path. It is
never part of `./run.sh`, uses isolated names/ports/networks/volume, and removes
its disposable stack. Production deployment is repository-owned and targets
the `pi5ram8` runner; see [`docs/deployment.md`](docs/deployment.md).
The Pi database is backed up at `00:00 Europe/Prague` by a user-systemd timer;
the guarded operation retains seven successful private custom-format archives
and provides an isolated restore test. Install or repair that timer only through
the reviewed repository installer documented in `docs/deployment.md`.
After Pi authority is confirmed, local `league_analysis_local_dev` is a
disposable one-way mirror checked against the Pi every five minutes. Matching
snapshots skip the full refresh. Local data may be overwritten; the mirror has
no local-to-Pi write command.

The Raspberry Pi hosts multiple projects. For production operations, target
only the exact League Analysis Docker resources and verify their Compose labels
before acting:

- Compose service `frontend` uses container `league-analysis-frontend` and a
  commit-tagged `league-analysis-frontend` image; Next.js is exposed on host
  port `8097`.
- Compose service `backend` uses container `league-analysis-backend` and a
  commit-tagged `league-analysis-backend` image; FastAPI is exposed on host
  port `8098`.
- Compose service `postgres` uses container `league-analysis-postgres` and the
  pinned upstream PostgreSQL 18 image; it is internal-only with no host port.

Never infer ownership from generic names such as `frontend`, `backend`, or
`postgres`, which may refer to a different Compose project on the same Pi.
The one-shot `migrate` service has no fixed container name and reuses the
backend image. The exact mapping and secret-safe verification commands are in
[`docs/deployment.md`](docs/deployment.md#production-topology).

Each `run.sh` invocation creates `logs/` before redirecting backend or frontend
output, so fresh checkouts do not require manual log-directory setup.
It requires `lsof` and `ss` and stops existing TCP listeners on the selected
frontend and backend ports before checking the database, applying reviewed
Alembic revisions through the locked migration runner, or starting replacement
services. A migration failure cancels startup. `ss` covers WSL cases where
`lsof` cannot report a listener.

Backend API docs are at `http://localhost:8000/api`; the frontend is at
`http://localhost:3000`. After changing `.env`, a restart is required. Do not
restart an already running development session unless necessary; stop the
current session first and tell the user at handoff when a restart is required.

## Validation

Use validation proportional to the changed scope:

```bash
# Documentation-only
git diff --check

# Frontend plus repository tooling
./test.sh -f

# Backend plus repository tooling
./test.sh -b

# Complete pre-publication gate
./test.sh
```

Run the complete gate before every pull request. Before a commit, allow the
configured pre-commit hooks to run; never bypass them. See
[`docs/quality-checks.md`](docs/quality-checks.md) for the exact local,
pre-commit, and GitHub-only boundaries.

When an IDE/workspace `get_errors` diagnostic is available, run it on changed
code files to catch syntax, import, and type errors early; it complements but
does not replace the configured gates.

When debugging runtime failures, inspect both logs before changing code.

## Repository-Wide Safety and Maintenance

- Never commit credentials, API keys, tokens, or `.env` contents.
- The only documented exception is LGA-11's deliberately non-secret,
  local-development-only QA fixtures. They are never valid for production or a
  shared environment, and the cleanup command refuses any target unless
  `ENVIRONMENT=dev`, the configured host, every PostgreSQL `listen_addresses`
  bind, and the active listener are loopback-only, and the explicit database
  name matches `POSTGRES_DB`. The command checks the configured target before
  opening a database session and requires a canonical outside-repository backup
  path with private `0600` permissions. During `--apply`, it blocks writers to
  every table it changes before taking the backup and preserves revoked access
  token blacklist entries:
  - Admin: `mat.kadlec@email.cz` / `LocalAdminQa123!`
  - Client: `scipiocz@gmail.com` / `LocalUserQa123!`
  Keep these fixture values stable for local browser/API smoke tests. Reset
  only these accounts through `backend/scripts/cleanse_local_riot_data.py`; do
  not use the command or fixture passwords for arbitrary accounts.
- Do not commit, push, or publish unless the user request or an explicitly named
  workflow authorizes that delivery step.
- Never use unsafe force push. Where rebasing a published task branch is
  authorized, use `--force-with-lease`.
- Do not modify Riot API rate-limiting behavior unless the task explicitly
  scopes that work; preserve the boundaries in
  [`docs/riot-api.md`](docs/riot-api.md).
- Never let SQLAlchemy create application tables. Reviewed Alembic revisions in
  `backend/alembic/versions/` are the schema authority.
- Apply schema changes through `backend/scripts/migrate.py` after reviewing a
  matching Alembic revision; never reset, drop, or recreate populated schemas.
- Keep explicit imports, avoid wildcard imports, and do not add stream-of-
  consciousness comments to code.
- Runtime behavior changes must update the matching authoritative document and
  the applicable scoped `AGENTS.md` in the same task.
- End implementation handoffs with a concise summary of changes and validation.
