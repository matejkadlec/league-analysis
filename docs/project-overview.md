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

Two applications live at the repository root: `backend/` (FastAPI; domain
features under `app/features/<name>/`, shared infrastructure under
`app/core/`, reviewed schema revisions under `alembic/versions/`) and
`frontend/` (Next.js App Router; `app/`, `components/`, `features/`, and
`lib/core/`). Repository tooling is `scripts/`, `.githooks/`, `deploy/`
(release shipping), `backup/` (database backup, restore, and mirror
operations), `run.sh`, and `test.sh` (the mandatory pre-publication gate). The
current
file inventory is the tree itself; this document records only the boundaries
that constrain changes.

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

The authenticated player provider owns the normal current-player context.
Player Overview, Match History and Smurf & Boost Detection use an explicit
`?puuid=` as the tab-local authority and the account's saved current PUUID only
as the default for new navigation. Player Overview owns aggregate/statistical cards; Match History is
a separate top-level detailed workflow. The sidebar is the canonical search
and current-player surface. Clicking the current-player row opens the Tracked
Players dialog without changing the active route; that dialog owns the complete
tracked-list switch/management flow. `/my-profile`, `/playstyle-analysis`, and
`/tracked-players` are PUUID-preserving compatibility redirects to Player
Overview.

Matchmaking Analysis is the deliberate exception: the global current player is
shown as its reference/default, while the page owns a separate analyzed-player
PUUID. Its compact selector uses the shared suggestion/discovery contract and
never tracks the analyzed player or changes the global context. Settings exposes
working account/security controls and, for administrators, Riot API
configuration; obsolete theme/default-server controls and the unapproved Riot
account-link affordance are not product settings.

The sign-in flow keeps its password-visibility control accessible and preserves
the entered value while it toggles. It bounds the browser login request and maps
trusted authentication codes, including inactive accounts, and HTTP status
classes to concise user-facing messages; raw server, network, and implementation
error text is never rendered.

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

FastAPI and SQLAlchemy on the backend, Next.js and React on the frontend,
PostgreSQL underneath. `backend/pyproject.toml`, `backend/uv.lock`,
`frontend/package.json` and `frontend/package-lock.json` are the version
authority; read them for versions.

Use `uv` for backend dependencies and commands, npm for frontend dependencies
and commands, and do not introduce a second package manager.

Three choices are not obvious from the manifests:

- The database driver is split. `asyncpg` serves application I/O; APScheduler
  needs `psycopg2` because its job store is synchronous.
- The frontend installs two TypeScript packages. `@typescript/native` is the
  compiler; the aliased TypeScript 6 package exists only because ESLint still
  consumes the older compiler API.
- ESLint loads Next.js plugins through `@eslint/compat`, which adapts their
  legacy rule API without suppressing any configured rule.

## Local Environment

The supported local setup is WSL with PostgreSQL 18.4. The repository-root
`.env` provides database and runtime configuration and is authoritative for
the normal `./run.sh` local launch. The launcher clears inherited backend
configuration names first, preventing WSL values from another worktree (such
as `POSTGRES_*` or an invalid `DEBUG`) from selecting a wrong database or
breaking startup. For a deliberate one-off process-level override only, use
`LGA_RUN_USE_PROCESS_ENV=1` with `./run.sh`. Never print, paste, commit, or
copy `.env` secret values into documentation or Jira.

Select the pinned Node and npm before the first npm command. `.nvmrc` and the
`packageManager` field hold those versions, and the gate rejects any other
runtime. Backend tooling needs a `uv` matching the version CI installs;
`uv lock --check` must accept the committed lock before development continues.

```bash
./run.sh
./run.sh 3001 8001
./run.sh --help
```

`run.sh` creates `logs/` before redirecting output, loads the current
worktree's protected `.env`, verifies the database connection, applies Alembic
revisions through the locked migration runner, starts Uvicorn with reload only
after migration succeeds, waits for the backend, installs frontend dependencies
only when `node_modules` is absent, and starts Next.js. Defaults:

- Frontend: <http://localhost:3000>
- Backend: <http://localhost:8000>
- Swagger UI: <http://localhost:8000/api>
- Backend log: `logs/backend.log`
- Frontend log: `logs/frontend.log`

`run.sh` requires `lsof` and `ss`. Before the database check, it gracefully
terminates TCP listeners on the selected frontend and backend ports, then
force-terminates only listeners that remain after five seconds. `ss` covers
WSL cases where `lsof` does not report a listener. Consequently, `./run.sh`
clears 3000 and 8000, `./run.sh 3001` clears 3001 and 8000, and
`./run.sh 3001 8001` clears 3001 and 8001. Do not use a selected port for any
other local process you need to keep running.

Changing `.env` requires a restart.

Docker is not a prerequisite for this native workflow. Explicit container
packaging/health validation uses `./deploy/container-qa.sh`; it creates an
isolated disposable stack and never reads the root `.env` or native database.

## Production Deployment

The repository owns production Dockerfiles, `compose.production.yml`, the
locked deployment script, and the `pi5ram16` GitHub Actions workflow. The stack
exposes the Next.js frontend on host port `8097`, FastAPI on `8098`, and keeps
PostgreSQL 18.4 internal-only. A one-shot migration service completes before
backend startup; backend readiness includes a database round trip, and
frontend startup waits for that readiness.

Production deployment consumes a private mode-`0600` host environment under
`$HOME/.local/share/league-analysis`; no complete runtime environment or secret
belongs in this repository. Deployment is serialized and bounded by migration
and health, but never drains or waits for normal application background jobs.
See [`deployment.md`](deployment.md) for the complete topology, explicit local
container QA, host bootstrap, diagnostics, and LGA-16 rollback boundary.

## Git hooks and worktrees

Once per clone, point Git at the tracked hook directory:

```bash
git config core.hooksPath .githooks
```

`.githooks/pre-commit` runs the configured pre-commit checks through the
backend's `uv` project. There is no other repository-managed hook.

New `flow1` work normally starts after fetch/conflict inspection with a focused
branch and sibling linked worktree:

```bash
git fetch --prune origin
git worktree add -b flow1/lga-43-batch-worktrees \
  ../league-analysis-lga-43 origin/master
cp .env ../league-analysis-lga-43/.env   # Only when the source checkout has one
```

Use the actual selected Jira keys and short scope in place of the example.
Separate planned pull requests use separate branches and worktrees. Never reuse,
reset, or delete an owner-created worktree without explicit authorization.

Git materializes only tracked files into a new worktree, and root `.env` is
ignored, so a new worktree starts without local configuration. Copy it
explicitly at creation time, as above. Copy that one file only — never a
directory, deployment credential, or provider bundle. A worktree created without
the copy is not broken: the backend fails at startup with a configuration error
until the file is present.

Keep worktrees needed for User QA or remediation. Cleanup is appropriate only
after the branch is safely published, ownership is clear, and the worktree is no
longer needed; inspect dirty state and PR/merge state first.

## Agent Instruction Files

Repository skills in [`.agents/skills/`](../.agents/skills/) are the
authoritative workflow procedures (`flow1`, `flow2`, `qa1`, `qa2`);
[`ai-development-flow.md`](ai-development-flow.md) is the short human-facing
lifecycle index. Together with the `AGENTS.md` files, they are the canonical
guides for non-Claude agents.

Claude Code does not use them. `CLAUDE.md` files are self-contained Claude
Code guides — trimmed hard-rules-and-pointers entry points that never
reference or mirror `AGENTS.md` — and they prescribe no delivery workflow
beyond keeping Jira accurate and not duplicating tickets. Linked worktrees
created under `.claude/worktrees/` are ignored and never published.

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

The separate browser suite runs with `cd frontend && npx playwright install
chromium && npm run test:e2e`. Its API is intercepted with deterministic fixture
responses, so it does not require a Riot credential or a local database.

Use the workspace `get_errors` diagnostic on changed TypeScript files when it
is available; it complements ESLint and TypeScript rather than replacing them.

### Backend

```bash
./test.sh -b
```

This syncs the frozen `uv.lock`, validates pre-commit configuration, and runs
pytest, Ruff lint/format, Pyright, Bandit at medium severity and confidence,
vulture, deptry, and xenon at rank B (CC <= 10).
Use the workspace `get_errors` diagnostic on changed Python files when it is
available.

### Complete pre-publication gate

```bash
./test.sh
```

This is the authoritative developer gate, and GitHub Actions runs the same
script. It runs repository, frontend, and backend checks with clear, fail-fast
step names.

### Commits and GitHub

`.pre-commit-config.yaml` runs the configured commit-time checks. Never skip
them. Each local hook resolves the Git worktree root before doing anything, so
commits behave the same from a linked worktree as from the main checkout. See
[`quality-checks.md`](quality-checks.md) for the GitHub side.

## Debugging and Operational Boundaries

Inspect logs before changing code in response to a runtime error:

```bash
tail -50 logs/backend.log
tail -50 logs/frontend.log
```

Typical evidence includes Riot `429` throttling, expired/invalid API keys,
import failures, and database connectivity errors.

Backend logs are structured JSON from structlog with static snake_case event
names. Every HTTP request produces one `http_request_completed` event
(`method`, `path`, `status_code`, `duration_ms`, `request_id`) — warning on
4xx, error on 5xx, debug for `/health` probes — and unhandled exceptions
produce `http_request_exception` with the traceback. Security events
(`login_failed`, `login_succeeded`, `access_token_rejected`,
`admin_access_denied`) and Riot-client retry/failure events
(`riot_api_retrying_server_error`, `riot_api_network_retry`,
`riot_api_request_failed`) carry the same fields; the request-logging
middleware binds `request_id` into every event emitted while serving a
request. The browser records unexpected API failures (`service`, `network`,
`timeout`, `unexpected` kinds) to the developer console through the shared
query and mutation cache handlers, and a Data Dragon manifest failure logs
its fallback stage server-side into the frontend log.

Do not let SQLAlchemy auto-create application tables. Apply schema changes
through `backend/scripts/migrate.py`, which holds one PostgreSQL advisory lock
for the full Alembic operation. Every model/schema change needs a reviewed
revision and an update to `docs/database.md`. The initial baseline is
intentionally non-reversible; recover from a verified backup rather than
dropping application schemas. Local `./run.sh` performs the normal `upgrade
head` before starting application writers; a populated database without an
Alembic marker still requires the explicit adoption procedure in
`docs/database.md`.
