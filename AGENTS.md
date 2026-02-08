# League Analysis - AI Agent Guide

> **Keep this file updated**: When making significant changes to the codebase, update this file and related documentation to reflect the current state.

## Quick Start

**Environment**: WSL (Windows Subsystem for Linux), PostgreSQL 18 on localhost:5432  
**Database**: `league-analysis` (user: `admin`, password in `.env`)

```bash
./run.sh                  # Start backend + frontend (hot reload)
tail -f logs/backend.log  # Backend logs
tail -f logs/frontend.log # Frontend logs
```

**Services**:

- Backend: http://localhost:8000 (`/api` for Swagger docs)
- Frontend: http://localhost:3000

**⚠️ CRITICAL**: After editing `.env`, restart `run.sh`

---

## Documentation Index

| Document                                 | Description                            |
| ---------------------------------------- | -------------------------------------- |
| [docs/database.md](docs/database.md)     | Database schema, tables, relationships |
| [docs/riot-api.md](docs/riot-api.md)     | Riot API endpoints, usage, rate limits |
| [docs/jobs.md](docs/jobs.md)             | Background jobs (Match Fetcher, etc.)  |
| [backend/AGENTS.md](backend/AGENTS.md)   | Backend architecture, code patterns    |
| [frontend/AGENTS.md](frontend/AGENTS.md) | Frontend architecture, components      |

### Feature-Level Documentation

- [backend/app/core/AGENTS.md](backend/app/core/AGENTS.md) - Core infrastructure
- [backend/app/core/riot_api/AGENTS.md](backend/app/core/riot_api/AGENTS.md) - Riot API client
- [backend/app/features/AGENTS.md](backend/app/features/AGENTS.md) - Feature patterns
- [backend/app/features/jobs/AGENTS.md](backend/app/features/jobs/AGENTS.md) - Job implementation
- [frontend/app/AGENTS.md](frontend/app/AGENTS.md) - Page patterns
- [frontend/components/AGENTS.md](frontend/components/AGENTS.md) - Shared components
- [frontend/features/AGENTS.md](frontend/features/AGENTS.md) - Feature components

---

## Tech Stack

| Layer        | Technologies                                                             |
| ------------ | ------------------------------------------------------------------------ |
| **Backend**  | Python 3.13, FastAPI, SQLAlchemy 2.0, PostgreSQL 18, uv                  |
| **Frontend** | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, shadcn/ui |
| **Data**     | TanStack Query, Zod, Axios                                               |
| **External** | Riot Games API                                                           |

---

## Project Structure

```
league-analysis/
├── backend/
│   ├── app/
│   │   ├── core/           # Infrastructure (database, config, Riot API)
│   │   │   └── riot_api/   # Riot API client
│   │   └── features/       # Domain features
│   │       ├── auth/
│   │       ├── jobs/
│   │       ├── matches/
│   │       ├── matchmaking_analysis/
│   │       ├── players/
│   │       ├── playstyle_analysis/
│   │       └── settings/
│   └── init_database.sql   # Database schema (source of truth)
├── frontend/
│   ├── app/                # Next.js pages
│   ├── components/         # Shared components + shadcn/ui
│   ├── features/           # Domain UI components
│   └── lib/core/           # API client, schemas, utilities
├── docs/                   # Documentation
└── logs/                   # Runtime logs
```

---

## Database Management

**Source of Truth**: `backend/init_database.sql`

**Tracked Players Model**: User-specific tracking lives in `auth.user_tracked_players`
(`user_id` ↔ `puuid`). `core.players.is_tracked` is a derived global flag used by jobs.

### Schema Change Workflow

1. Update SQLAlchemy models in `backend/app/features/*/models.py`
2. Update `backend/init_database.sql`
3. **Incremental Update (PREFERRED)**: Generate and execute `ALTER TABLE` commands
4. **Full Reset (Last Resort)**: `psql -f backend/init_database.sql`

See [docs/database.md](docs/database.md) for schema details.

---

## Code Rules

### Backend

- async/await for all I/O
- Type hints everywhere
- structlog with context keys: `logger.info("action", puuid=puuid)`
- Features depend on core, never reverse

### Frontend

- TypeScript strict mode (no `any`)
- `"use client"` for hooks/events/browser APIs
- TanStack Query for all data fetching
- Handle loading/error/success states

### Both

- Explicit imports only (no wildcards)
- No "thinking comments" in code
- Features expose public APIs via `__init__.py` (backend) or `index.ts` (frontend)

---

## Constraints

- ❌ **NEVER** commit API keys/secrets
- ❌ **NEVER** commit for user in general
- ❌ **NEVER** modify Riot API rate limiting logic
- ❌ **NEVER** let SQLAlchemy auto-create tables
- ❌ **NEVER** skip pre-commit hooks

---

## Debugging

### Auto-Check Logs

When encountering errors, **always check logs first**:

```bash
tail -50 logs/backend.log
tail -50 logs/frontend.log
```

Common issues visible in logs:

- `429 Too Many Requests` - Rate limit hit
- `401/403` - API key expired
- `ImportError`, `NameError` - Missing imports
- Database connection errors

### Quality Assurance

After modifying code, run these checks by default:

```bash
cd frontend && npm run lint
cd frontend && npx tsc --noEmit
cd backend && uv run pyright
```

All checks must finish with **0 errors and 0 warnings** before considering the task done.

Also run `get_errors` on changed files to catch:

- TypeScript type errors
- Python syntax errors
- Import issues

---

## AI Agent Instructions - follow strictly

1. **Read relevant AGENTS.md first** - Before working on a feature, read the corresponding AGENTS.md file
2. **Check logs on errors** - Auto-check `logs/backend.log` and `logs/frontend.log`
3. **Update documentation** - Keep AGENTS.md files, README.md and files in `docs/` up to date
4. **Summarize changes** - End responses with a concise overview of changes made
5. **Verify with tools** - Run frontend `npm run lint` + `npx tsc --noEmit` and backend `uv run pyright`; fix all warnings/errors
6. **Use get_errors too** - Use `get_errors` after edits to catch file-level issues early
7. **Use PSQL console** - If you need to run an SQL command (i.e. after modifying `init_database.sql`
   to keep the actual DB synced), use psql console. You will always need admin pw which is in `.env`.
8. **Server shutdown** - Don't do server restart unless it's really needed. If you really need to do so,
   shutdown the currently running session (I'm running the server locally all the time while coding),
   and only after this run the server; otherwise it won't work and you will need to shut current
   session anyway + it might cause issues if you don't do the shutdown first.
9. **Restart is needed** - If a server restart is need in order for your changes to apply, prompt the
   user to do so at the very end of your response.
