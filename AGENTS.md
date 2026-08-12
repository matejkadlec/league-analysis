# League Analysis - AI Agent Guide

> **Scope:** Repository-wide instructions. More specific `AGENTS.md` files add
> subtree guidance but may not weaken these rules.
>
> **Maintenance:** Update this file when repository identity, the workflow
> gate, top-level structure, or repository-wide safety rules change. Detailed
> procedure lives in the repository skills; architecture and operating notes
> live in [`docs/`](docs/README.md).

## Repository and Project Identity (Mandatory)

- Canonical GitHub repository: `matejkadlec/league-analysis`
  (<https://github.com/matejkadlec/league-analysis>); default branch `master`.
- Canonical Jira project: `League Analysis`, key `LGA`, board `34`,
  Continuous QA issue `LGA-1`.
- Scope every Jira read/write to project `LGA` and every GitHub write to
  `matejkadlec/league-analysis`. Before every Jira write, verify the issue-key
  prefix; before every GitHub write, verify the exact repository target and
  current `origin` remote. Treat any target mismatch as a blocker; never guess
  the intended project or repository from the authenticated account, and never
  mutate another Jira project or GitHub repository without an explicit
  cross-target request.

## Workflow Gate (Mandatory)

Before Jira intake, creation, or selection; Jira-scoped implementation;
User-QA handoff or remediation; or PR publication/update, invoke the matching
repository skill (flow1, flow2, qa1, or qa2) and follow its stop boundary.

The skills live in [`.claude/skills/`](.claude/skills/) (Codex discovers the
same files through the [`.agents/skills/`](.agents/skills/) symlinks). They
are authoritative for intake, batching, QA classification, branches and
worktrees, pull requests, remediation, and owner handoff.
[`docs/ai-development-flow.md`](docs/ai-development-flow.md) is the short
human-facing lifecycle index.

Non-negotiable boundaries the skills cannot weaken:

- Jira lifecycle: `TO DO` -> `NEXT` -> `IN PROGRESS` ->
  optional `PENDING USER QA` -> `PENDING CR` -> `DONE`. Move an issue to
  `DONE` only after its pull request is merged into `master`.
- Do not push task work directly to `master` unless the user explicitly grants
  that exception. Normal task work starts from current `origin/master`.
- Intentional visual changes require owner (User) QA before publication.
- An AI-created pull request is ready for review, never a draft. Each
  published PR becomes owner-managed immediately: do not poll, review, repair,
  merge, or deploy it. Owner-managed review and merge are workflow policy, not
  an identity control supplied by the zero-approval ruleset; agents must not
  merge without explicit owner authorization.
- Preserve unrelated dirty changes, branches, and worktrees.

## Repository Map

| Area | Authority |
| --- | --- |
| Documentation map and ownership | [`docs/README.md`](docs/README.md) |
| Project structure, stack, and commands | [`docs/project-overview.md`](docs/project-overview.md) |
| Quality gates and GitHub Actions | [`docs/quality-checks.md`](docs/quality-checks.md) |
| Production containers and Pi deployment | [`docs/deployment.md`](docs/deployment.md) |
| AI/Jira/GitHub lifecycle index | [`docs/ai-development-flow.md`](docs/ai-development-flow.md) |
| GitHub branch governance | [`docs/github-governance.md`](docs/github-governance.md) |
| Backend conventions | [`backend/AGENTS.md`](backend/AGENTS.md) |
| Frontend conventions | [`frontend/AGENTS.md`](frontend/AGENTS.md) |
| Database schema revisions | [`backend/alembic/versions/`](backend/alembic/versions/) |
| Database explanation and change workflow | [`docs/database.md`](docs/database.md) |
| Riot API integration | [`docs/riot-api.md`](docs/riot-api.md) |
| Background jobs and scheduler | [`docs/jobs.md`](docs/jobs.md) |
| Cookie/storage consent | [`docs/cookie-consent-compliance.md`](docs/cookie-consent-compliance.md) |

Read the nearest applicable `AGENTS.md` before editing a subtree.
Documentation records durable system decisions; Jira records planned and
in-flight work.

## Quick Start

The local environment is WSL with PostgreSQL 18. Configuration is loaded from
the repository-root `.env`; keep its values secret. After changing `.env`, a
restart is required.

```bash
./scripts/install-git-hooks.sh   # After clone and after hook changes
./run.sh                         # Backend 8000 + frontend 3000
./run.sh 3001 8001               # Custom frontend/backend ports
tail -50 logs/backend.log
tail -50 logs/frontend.log
```

Each `run.sh` invocation creates `logs/` before redirecting backend or frontend
output. It stops existing listeners on the selected ports, checks the
database, and applies reviewed Alembic revisions through the locked migration
runner before starting services; a migration failure cancels startup. Backend
API docs are at `http://localhost:8000/api`; the frontend is at
`http://localhost:3000`. Do not restart an already running development session
unless necessary; stop the current session first and tell the user at handoff
when a restart is required. `./deploy/container-qa.sh` is the explicit Docker
packaging/health path, never part of `./run.sh`. Production runs on a shared
Raspberry Pi that hosts multiple projects: target only League Analysis
resources and verify their Compose labels first — see
[`docs/deployment.md`](docs/deployment.md#production-topology). Install or
repair the Pi database backup timer only through the reviewed repository
installer documented in [`docs/deployment.md`](docs/deployment.md).

## Validation

Use validation proportional to the changed scope:

```bash
git diff --check   # Documentation-only
./test.sh -f       # Frontend plus repository tooling
./test.sh -b       # Backend plus repository tooling
./test.sh          # Complete pre-publication gate
```

Run the complete gate before every pull request. Let the configured pre-commit
hooks run; never bypass them. See
[`docs/quality-checks.md`](docs/quality-checks.md) for the exact local,
pre-commit, and GitHub-only boundaries. When debugging runtime failures,
inspect both logs before changing code.

## Repository-Wide Safety

- Never commit credentials, API keys, tokens, or `.env` contents, and never
  request secrets or complete environment files in chat or Jira. The only
  documented exception is LGA-11's deliberately non-secret, local-only QA
  fixtures (admin `mat.kadlec@email.cz` / `LocalAdminQa123!`, client
  `scipiocz@gmail.com` / `LocalUserQa123!`). Keep these fixture values stable
  for local browser/API smoke tests, reset only these accounts through the
  guarded `backend/scripts/cleanse_local_riot_data.py`, and do not use the
  command or fixture passwords for arbitrary accounts; see
  [`docs/database.md`](docs/database.md).
- Do not commit, push, or publish unless the user request or an explicitly
  named workflow authorizes that delivery step. Never use unsafe force push;
  where rebasing a published task branch is authorized, use
  `--force-with-lease`.
- Never let SQLAlchemy create application tables. Reviewed Alembic revisions
  in `backend/alembic/versions/` are the schema authority; apply them through
  `backend/scripts/migrate.py` and never reset, drop, or recreate populated
  schemas.
- Do not modify Riot API rate-limiting behavior unless the task explicitly
  scopes that work; preserve the boundaries in
  [`docs/riot-api.md`](docs/riot-api.md).
- Riot PUUIDs are encrypted per developer account: stored PUUIDs return `400`
  under a key from a different developer account, and switching accounts is a
  data migration. Never auto-merge player rows; see
  [`docs/riot-api.md`](docs/riot-api.md#puuids-are-bound-to-the-developer-account).
- Keep explicit imports, avoid wildcard imports, and do not add stream-of-
  consciousness comments to code.
- Runtime behavior changes must update the matching authoritative document and
  the applicable scoped `AGENTS.md` in the same task.
- End implementation handoffs with a concise summary of changes and validation.
