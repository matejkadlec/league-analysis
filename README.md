# League Analysis

League Analysis is a private, actively developed full-stack League of Legends
analytics application. It combines authenticated player tracking, match and
timeline ingestion, rank history, playstyle signals, matchmaking-quality
analysis, and administrator-managed background jobs.

This README is the entry point for contributors with authorized repository
access. Detailed architecture, operations, integration, database, and workflow
guidance is indexed in [`docs/README.md`](docs/README.md).

## Architecture

| Area | Current basis |
| --- | --- |
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS, TanStack Query, Zod |
| Backend | Python 3.14, FastAPI, SQLAlchemy, Pydantic, APScheduler |
| Data | PostgreSQL 18 with reviewed Alembic revisions |
| External integration | Riot Games API |
| Tooling | Node 26.7.0, npm 12.0.2, uv 0.12.3, GitHub Actions |

The supported local development flow is non-Docker. Production packaging and
the pi5ram16 deployment are repository-owned but remain an explicit, separate
path; see [the deployment guide](docs/deployment.md) and do not substitute
container commands for the local workflow below.

## Prerequisites

Use a WSL development environment with:

- Git and authorized SSH access to this private repository;
- Node 26.7.0 through NVM and npm 12.0.2;
- Python 3.14.7 and uv 0.12.3;
- an already-provisioned PostgreSQL 18.4 database and role matching the
  non-secret `POSTGRES_DB` and `POSTGRES_USER` configuration values;
- a root `.env` file from the authorized private configuration source.

Never paste, commit, or share `.env` values. The file is ignored and must stay
outside source control. Explicit process environment variables take precedence
over its values; see [the local-environment guidance](docs/project-overview.md#local-environment)
for the configuration boundary.

## Set up a fresh checkout

```bash
git clone git@github.com:matejkadlec/league-analysis.git
cd league-analysis

nvm install 26.7.0
nvm use 26.7.0
npm install --global npm@12.0.2 --ignore-scripts

(cd frontend && npm ci)
(cd backend && uv sync --frozen --all-groups)
git config core.hooksPath .githooks
```

The last command points Git at the tracked `.githooks/pre-commit` wrapper, which
runs the configured pre-commit checks; see
[project overview](docs/project-overview.md#git-hooks-and-worktrees).

## Database and local application

Point the private root `.env` at the verified local PostgreSQL database. The
migration command creates application schemas, not the database or role, so
provision that target before applying the reviewed schema revisions:

```bash
(cd backend && uv run python scripts/migrate.py upgrade head)
./run.sh
```

`./run.sh` starts the frontend at <http://localhost:3000> and the backend at
<http://localhost:8000>; API documentation is available at
<http://localhost:8000/api>. Use `./run.sh 3001 8001` for alternate local ports.
`run.sh` requires `lsof` and `ss` and stops existing TCP listeners on its
selected frontend and backend ports before starting: `./run.sh` clears 3000/8000,
`./run.sh 3001` clears 3001/8000, and `./run.sh 3001 8001` clears 3001/8001.
`ss` covers WSL cases where `lsof` does not report a listener.
This terminates any local process listening on those ports. The full command,
log locations, and restart behavior are documented in
[project overview](docs/project-overview.md#local-environment).

Alembic revisions in [`backend/alembic/versions/`](backend/alembic/versions/)
are the schema authority. For a populated local database without an Alembic
marker, follow the explicit [safe adoption process](docs/database.md#source-of-truth)
instead of resetting or recreating schemas.

## Riot API development key

Obtain a Riot development key through the authorized Riot Developer Portal.
Development keys expire every 24 hours. Configure it only through the Settings
page, which is the sole place the key is ever entered; never put the key in a
commit, issue, documentation example, or chat message. The key handling,
routing, rate limits, and endpoint constraints are maintained in
[`docs/riot-api.md`](docs/riot-api.md).

Ordinary local quality checks do not require a real Riot API key.

## Validation

Run these commands from the repository root:

```bash
./test.sh -f  # repository and frontend feedback gate
./test.sh -b  # repository and backend feedback gate
./test.sh     # complete pre-pull-request quality gate
```

The complete gate runs deterministic installs, linting, type checks, frontend
and backend regression tests, the production frontend build, static security
analysis, ShellCheck, workflow checks, migration validation, and repository
tooling regressions. Local success is not GitHub check success. See
[`docs/quality-checks.md`](docs/quality-checks.md) for the current boundary.

When Docker Compose v2 is intentionally available, the separate
`./deploy/container-qa.sh` command builds and health-checks a disposable stack
without reading the native `.env` or database.

## Further reading

- [Project overview and local operation](docs/project-overview.md)
- [Database and migration workflow](docs/database.md)
- [Riot API integration](docs/riot-api.md)
- [Quality checks and CI](docs/quality-checks.md)
- [Production containers and pi5ram16 deployment](docs/deployment.md)
- [AI/Jira/GitHub delivery flow](docs/ai-development-flow.md)

## License

**All Rights Reserved** © 2026 League Analysis.
