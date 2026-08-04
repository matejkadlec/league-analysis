# Project Overview and Technical Basis

> **Authority:** Current project summary, repository structure, technology
> choices, local operation, and verification commands.
>
> **Maintenance:** Update when the product boundary, top-level layout,
> dependencies, runtime entrypoints, or repository checks change.

## Product Summary

League Analysis is a full-stack League of Legends analytics application. It
combines authenticated user-specific player tracking, match and timeline
ingestion, rank history, player/profile statistics, playstyle analysis,
matchmaking-quality analysis, runtime settings, and administrator-controlled
background jobs.

Riot Games API is the external gameplay-data integration. PostgreSQL persists
application, analysis, scheduler, and authentication state.

## Architecture and Feature Boundaries

```text
league-analysis/
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── core/
│   │   │   └── riot_api/
│   │   └── features/
│   │       ├── auth/
│   │       ├── jobs/
│   │       ├── matches/
│   │       ├── matchmaking_analysis/
│   │       ├── players/
│   │       ├── playstyle_analysis/
│   │       └── settings/
│   ├── alembic/
│   ├── alembic.ini
│   ├── scripts/
│   ├── pyproject.toml
│   └── uv.lock
├── frontend/
│   ├── app/
│   ├── components/
│   ├── features/
│   ├── lib/core/
│   ├── package.json
│   └── package-lock.json
├── .githooks/
│   ├── pre-commit
│   └── post-checkout
├── docs/
├── logs/
├── scripts/
│   ├── guard-git-worktree-test.sh
│   ├── install-git-hooks.sh
│   └── provision-worktree-local-files.sh
└── run.sh
```

### Backend

`backend/app/main.py` creates the FastAPI application and registers feature
routers. The normal API prefix is `/api/v1`; authentication lives below
`/api/v1/auth`. The application retains unversioned compatibility routes for
players, matches, playstyle analysis, and jobs.

`backend/app/core/` owns shared configuration, database sessions, validation,
errors, and Riot API infrastructure. Domain features may depend on core; core
must not depend on features. Each feature owns its router, service/model/schema
code where applicable and exposes public imports through `__init__.py`.

### Frontend

`frontend/app/` uses the Next.js App Router. `frontend/features/` groups domain
UI for authentication, consent, jobs, matches, matchmaking, players,
playstyle analysis, and profile statistics. `frontend/components/` contains
shared application components and shadcn/ui primitives; `frontend/lib/core/`
contains shared API, schema, validation, and utility code.

TanStack Query owns server-data fetching and cache state. Zod validates API
payloads at the frontend boundary.

### Data

Reviewed Alembic revisions under `backend/alembic/versions/` are the executable
schema source of truth. The schemas are:

- `auth`: users, sessions/tokens, settings, consent, contact metadata, and
  user-to-player tracking.
- `core`: players, matches, participants, timelines, analyses, rank history,
  Riot keys, and coordinated rate-limit state.
- `jobs`: configurations, executions, and APScheduler persistence.

See [`database.md`](database.md) before changing models or SQL.

## Technology

Versions are pinned or constrained by `backend/pyproject.toml`,
`backend/uv.lock`, `frontend/package.json`, and `frontend/package-lock.json`.

| Layer | Current basis |
| --- | --- |
| Backend runtime | Python `>=3.14.6,<3.15`, FastAPI 0.141.1, SQLAlchemy 2.0.51, Pydantic 2.13, structlog 26.1, APScheduler 3.11, httpx 0.28 |
| Backend tooling | uv 0.12.1 in CI, Pyright 1.1.411, Ruff 0.16.1 |
| Frontend runtime | Next.js 16.2.12, React 19.2.8, TypeScript 7.0.2 native compiler with TypeScript 6.0.2 API compatibility for ESLint, Tailwind CSS 4.3.3, shadcn/ui |
| Frontend data/forms | TanStack Query 5, Zod 4, Axios, React Hook Form |
| Frontend tooling | Node 26.5.1, npm 12.0.2 with `package-lock.json`, ESLint 10.8.0 with `@eslint/compat` for Next's legacy plugins, TypeScript 7.0.2 compiler, Vitest 4.1.10 |
| Database | PostgreSQL 18.4, asyncpg for application I/O, psycopg2 for APScheduler |
| External data | Riot Games API |

Use `uv` for backend dependencies and commands. Use npm for frontend
dependencies and commands; do not introduce a second package manager.
The dated selection and security rationale is recorded in
[`dependency-upgrade-2026-08-03.md`](dependency-upgrade-2026-08-03.md).

## Local Environment

The supported local setup is WSL with PostgreSQL 18.4. The repository-root
`.env` provides database and runtime configuration; explicit process
environment values take precedence. Never print, paste, commit, or copy its
secret values into documentation or Jira.

Install/select the exact frontend tools before the first npm command:

```bash
nvm install 26.5.1
nvm use 26.5.1
npm install --global npm@12.0.2 --ignore-scripts
```

CI pins uv 0.12.1. Local uv 0.12.1 can be installed through the official
installer or selected package manager; `uv lock --check` must accept the
committed lock before development continues.

```bash
./run.sh
./run.sh 3001 8001
./run.sh --help
```

`run.sh` creates `logs/` before redirecting output, verifies the database
connection, starts Uvicorn with reload, waits for the backend, installs frontend
dependencies only when `node_modules` is absent, and starts Next.js. Defaults:

- Frontend: <http://localhost:3000>
- Backend: <http://localhost:8000>
- Swagger UI: <http://localhost:8000/api>
- Backend log: `logs/backend.log`
- Frontend log: `logs/frontend.log`

`run.sh` requires `lsof`. Before the database check, it gracefully terminates
TCP listeners on the selected frontend and backend ports, then force-terminates
only listeners that remain after five seconds. Consequently, `./run.sh` clears
3000 and 8000, `./run.sh 3001` clears 3001 and 8000, and
`./run.sh 3001 8001` clears 3001 and 8001. Do not use a selected port for any
other local process you need to keep running.

Changing `.env` requires a restart.

## Production Deployment Boundary

Production Docker packaging and VPS operating procedures are not yet present in
this repository. LGA-10 owns the reviewed images, Compose/deployment wiring,
migration ordering, health checks, network hardening, and production
troubleshooting guidance; LGA-16 owns the backup, restore, rollback, and
incident runbook. Until those tickets are complete, `./run.sh` remains the only
supported application start command documented here for local development.

## Git hooks and worktrees

After clone, and whenever `.githooks/` or the local-file provisioner changes,
install the reviewed hook generation:

```bash
./scripts/install-git-hooks.sh
```

The installer snapshots the pre-commit and post-checkout hooks plus the
provisioner beneath the shared Git directory, sets restrictive permissions, and
atomically selects the complete generation through `core.hooksPath`. It records
ownership in `league-analysis.trustedhookspath` and preserves an unrelated
custom hooks manager instead of overwriting it. The pre-commit snapshot runs the
configured pre-commit checks; the post-checkout snapshot never executes hook
code from the branch being checked out.

New `flow1` work normally starts after fetch/conflict inspection with a focused
branch and sibling linked worktree:

```bash
git fetch --prune origin
git worktree add -b flow1/lga-43-batch-worktrees \
  ../league-analysis-lga-43 origin/master
```

Use the actual selected Jira keys and short scope in place of the example.
Separate planned pull requests use separate branches and worktrees. Never reuse,
reset, or delete an owner-created worktree without explicit authorization.

When the primary worktree has a regular root `.env`, the trusted post-checkout
hook may copy that single allowlisted ignored file into a newly created linked
worktree. The copy uses mode `600`, never overwrites a path or symlink, never
prints content, requires shared trusted ignore rules for the target and
temporary-file pattern, and records private provenance so only its own copy can
be removed later. Missing source files, custom hook managers, or failed safety
checks leave checkout successful and unprovisioned. Do not manually broaden the
allowlist to directories or deployment credentials.

Keep worktrees needed for User QA or remediation. Cleanup is appropriate only
after the branch is safely published, ownership is clear, and the worktree is no
longer needed; inspect dirty state and PR/merge state first.

## Quality and Verification

[`quality-checks.md`](quality-checks.md) is authoritative for the gate design,
tool pins, test scope, and local-versus-GitHub boundary. Use focused modes while
implementing and the complete gate before publication.

### Documentation-only

```bash
git diff --check
```

Manually validate Markdown structure, relative links, instruction precedence,
and repository/project identifiers.

### Frontend

```bash
./test.sh -f
```

This selects Node from `.nvmrc`, runs `npm ci`, ESLint with zero warnings,
TypeScript, Vitest regressions, and a Next.js production build.

Use the workspace `get_errors` diagnostic on changed TypeScript files when it
is available; it complements ESLint and TypeScript rather than replacing them.

### Backend

```bash
./test.sh -b
```

This syncs the frozen `uv.lock`, validates pre-commit configuration, and runs
pytest, Ruff lint/format, Pyright, and Bandit at medium severity and confidence.
Use the workspace `get_errors` diagnostic on changed Python files when it is
available.

### Complete pre-publication gate

```bash
./test.sh
```

This is the authoritative developer gate and the core of `scripts/ci.sh` used
by GitHub Actions. It runs repository, frontend, and backend checks with clear,
fail-fast step names.

### Commits and GitHub

`.pre-commit-config.yaml` keeps fast whitespace/format checks, Ruff, frontend
ESLint, and frontend TypeScript checks at commit time. Never skip configured
hooks. GitHub's `Quality Checks` workflow runs the same deterministic gate with
PostgreSQL 18.4, plus a separate live production dependency audit. Local results
are not GitHub check results.

## Debugging and Operational Boundaries

Inspect logs before changing code in response to a runtime error:

```bash
tail -50 logs/backend.log
tail -50 logs/frontend.log
```

Typical evidence includes Riot `429` throttling, expired/invalid API keys,
import failures, and database connectivity errors.

Do not let SQLAlchemy auto-create application tables. Apply schema changes
through `backend/scripts/migrate.py`, which holds one PostgreSQL advisory lock
for the full Alembic operation. Every model/schema change needs a reviewed
revision and an update to `docs/database.md`. The initial baseline is
intentionally non-reversible; recover from a verified backup rather than
dropping application schemas.
