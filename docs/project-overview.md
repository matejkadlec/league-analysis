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
│   ├── init_database.sql
│   ├── pyproject.toml
│   └── uv.lock
├── frontend/
│   ├── app/
│   ├── components/
│   ├── features/
│   ├── lib/core/
│   ├── package.json
│   └── package-lock.json
├── docs/
├── logs/
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

`backend/init_database.sql` is the executable schema source of truth. The
schemas are:

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
| Backend runtime | Python `>=3.14.2,<3.15`, FastAPI, SQLAlchemy 2, Pydantic 2, structlog, APScheduler, httpx |
| Backend tooling | `uv`, Pyright |
| Frontend runtime | Next.js 16.1.6, React 19.2, TypeScript 5, Tailwind CSS 4, shadcn/ui |
| Frontend data/forms | TanStack Query 5, Zod 4, Axios, React Hook Form |
| Frontend tooling | npm with `package-lock.json`, ESLint 9, TypeScript compiler |
| Database | PostgreSQL 18, asyncpg for application I/O, psycopg2 for APScheduler |
| External data | Riot Games API |

Use `uv` for backend dependencies and commands. Use npm for frontend
dependencies and commands; do not introduce a second package manager.

## Local Environment

The supported local setup is WSL with PostgreSQL 18. The repository-root `.env`
provides database and runtime configuration. Never print, paste, commit, or
copy its secret values into documentation or Jira.

```bash
./run.sh
./run.sh 3001 8001
./run.sh --help
```

`run.sh` verifies the database connection, starts Uvicorn with reload, waits for
the backend, installs frontend dependencies only when `node_modules` is absent,
and starts Next.js. Defaults:

- Frontend: <http://localhost:3000>
- Backend: <http://localhost:8000>
- Swagger UI: <http://localhost:8000/api>
- Backend log: `logs/backend.log`
- Frontend log: `logs/frontend.log`

Changing `.env` requires a restart. Do not start a second development session
over an existing one; stop the running session first.

## Quality and Verification

Run checks for the code actually changed.

### Documentation-only

```bash
git diff --check
```

Manually validate Markdown structure, relative links, instruction precedence,
and repository/project identifiers.

### Frontend

```bash
cd frontend
npm run lint
npx tsc --noEmit
```

Both commands must finish with zero errors and zero warnings.

Use the workspace `get_errors` diagnostic on changed TypeScript files when it
is available; it complements ESLint and TypeScript rather than replacing them.

### Backend

```bash
cd backend
uv run pyright
```

Pyright must finish with zero errors and zero warnings. The repository does not
currently define a backend test suite or install `pytest`; do not present a
`pytest` command as a required gate unless tests and their tooling are added.
Use the workspace `get_errors` diagnostic on changed Python files when it is
available.

### Commits and GitHub

`.pre-commit-config.yaml` applies whitespace/format checks, Ruff, frontend
ESLint, and frontend TypeScript checks to matching files. Never skip configured
hooks.

The current repository tree contains issue templates but no GitHub Actions
workflow. Therefore there is no repository-defined GitHub-only CI gate to
report as passed. Local validation results are not GitHub check results.

## Debugging and Operational Boundaries

Inspect logs before changing code in response to a runtime error:

```bash
tail -50 logs/backend.log
tail -50 logs/frontend.log
```

Typical evidence includes Riot `429` throttling, expired/invalid API keys,
import failures, and database connectivity errors.

Do not let SQLAlchemy auto-create application tables. Apply schema changes
incrementally with `psql`; the full `backend/init_database.sql` script drops
the application schemas and must not be run against the populated local
database.
