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
- Classify intentional visual changes as User QA. Documentation, backend,
  schema, infrastructure, security, tests, refactors, and non-visual frontend
  logic are AI-only unless mixed with inseparable visual scope.
- Do not push task work directly to `master` unless the user explicitly grants
  that exception. Normal task work starts from current `origin/master`.
- An AI-created pull request is ready for review, not draft. Immediately after
  publishing or updating a ready pull request, transition its issues to
  `PENDING CR`, report the handoff, and stop. Do not poll, review, merge,
  deploy, or start another batch without explicit delegation for that pull
  request.
- Move an issue to `DONE` only after its pull request is merged into `master`.
- Never request secrets or complete environment files in chat or Jira.

## Repository Map

| Area | Authority |
| --- | --- |
| Documentation map and ownership | [`docs/README.md`](docs/README.md) |
| Project structure, stack, and commands | [`docs/project-overview.md`](docs/project-overview.md) |
| AI/Jira/GitHub development lifecycle | [`docs/ai-development-flow.md`](docs/ai-development-flow.md) |
| Backend conventions | [`backend/AGENTS.md`](backend/AGENTS.md) |
| Frontend conventions | [`frontend/AGENTS.md`](frontend/AGENTS.md) |
| Database schema | [`backend/init_database.sql`](backend/init_database.sql) |
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

```bash
./run.sh                         # Backend 8000 + frontend 3000
./run.sh 3001 8001              # Custom frontend/backend ports
./run.sh --help
tail -50 logs/backend.log
tail -50 logs/frontend.log
```

Backend API docs are at `http://localhost:8000/api`; the frontend is at
`http://localhost:3000`. After changing `.env`, a restart is required. Do not
restart an already running development session unless necessary; stop the
current session first and tell the user at handoff when a restart is required.

## Validation

Use validation proportional to the changed scope:

```bash
# Documentation-only
git diff --check

# Frontend behavior
cd frontend && npm run lint
cd frontend && npx tsc --noEmit

# Backend behavior
cd backend && uv run pyright
```

For application-wide code changes, run all three code checks. Before a commit,
allow the configured pre-commit hooks to run; never bypass them. See
[`docs/project-overview.md`](docs/project-overview.md#quality-and-verification)
for the exact local-versus-GitHub check boundary.

When an IDE/workspace `get_errors` diagnostic is available, run it on changed
code files to catch syntax, import, and type errors early; it complements but
does not replace the configured gates.

When debugging runtime failures, inspect both logs before changing code.

## Repository-Wide Safety and Maintenance

- Never commit credentials, API keys, tokens, or `.env` contents.
- Do not commit, push, or publish unless the user request or an explicitly named
  workflow authorizes that delivery step.
- Never use unsafe force push. Where rebasing a published task branch is
  authorized, use `--force-with-lease`.
- Do not modify Riot API rate-limiting behavior unless the task explicitly
  scopes that work; preserve the boundaries in
  [`docs/riot-api.md`](docs/riot-api.md).
- Never let SQLAlchemy create application tables. The schema authority is
  `backend/init_database.sql`.
- Apply schema changes incrementally with `psql`; never reset the populated
  database from the destructive full-schema script.
- Keep explicit imports, avoid wildcard imports, and do not add stream-of-
  consciousness comments to code.
- Runtime behavior changes must update the matching authoritative document and
  the applicable scoped `AGENTS.md` in the same task.
- End implementation handoffs with a concise summary of changes and validation.
