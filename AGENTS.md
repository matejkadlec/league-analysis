# Quick Start

**Environment**: WSL (Windows Subsystem for Linux), PostgreSQL 18 on localhost:5432
**Database**: `league-analysis` (user: `admin`, password in .env)

> **SYSTEM STATE (2026-01-20): REDEVELOPMENT PHASE**
> **Context**: Project recently underwent a major purge of unreliable legacy data and code. Old jobs and data wrappers were deleted.
> **Current Status**: "Clean Slate". We are incrementally re-implementing background jobs and feature logic on a sanitized base.
> **Database Warning**: The schema is **VOLATILE**. Columns, types, nullability, and constraints are subject to change. Do NOT assume schema stability. Always verify `backend/init_database.sql` serves as the source of truth, but cross-reference it with active `models.py`.
> **Migration Policy**: We do NOT use automated migration tools (Alembic etc.).
>
> 1. Update SQLAlchemy models in code.
> 2. Update `backend/init_database.sql` (Single Source of Truth).
> 3. **Incremental Update**: If preserving data is required, generate and provide the specific SQL commands to align the active database with `init_database.sql` (DROP old tables, CREATE new ones).
> 4. **Full Reset (Optional)**: If data is expendable, drop and recreate the DB using `psql -f init_database.sql`.
>    **Instruction**: Assume legacy job logic was flawed. When implementing new features, prioritize architectural correctness and data validation.

**Start development**:

```bash
tail -f logs/backend.log  # View logs
tail -f logs/frontend.log
./run.sh                  # Hot reload enabled (backend + frontend)
```

**Services**: Backend http://localhost:8000 (/api), Frontend http://localhost:3000

**URL Navigation**:

- Player Analysis: `http://localhost:3000/playstyle-analysis?puuid=<PUUID>` (uses URL query param for state)
- Matchmaking Analysis: `http://localhost:3000/matchmaking-analysis?puuid=<PUUID>` (uses URL query param for state)

**⚠️ CRITICAL**: After editing `.env`, restart `run.sh` (reads env vars on startup)

# Tech Stack

- **Backend**: FastAPI, SQLAlchemy 2.0, PostgreSQL, Python 3.13, uv
- **Frontend**: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, shadcn/ui
- **Data**: TanStack Query, Zod, Axios, Riot Games API

# Structure

## Backend (`backend/app/`)

- `core/`: Infrastructure (database, config, Riot API, enums)
- `features/`: Domain features (players, matches, jobs, playstyle_analysis, matchmaking_analysis, settings)
  - Each: `router.py`, `service.py`, `models.py`, `schemas.py`, `dependencies.py`

## Frontend (`frontend/`)

- `app/`: Next.js pages (App Router)
- `features/`: Domain UI (players, matches, jobs, player-analysis, matchmaking, settings)
- `components/`: Shared layout components and shadcn/ui
- `lib/core/`: Core utilities (API client, schemas, validations)

# Code Rules

**API**: Riot Games API integration (API Key and required parameter samples available in `.env`)
**Data**: TanStack Query, Zod validation, Axios

- **Backend**: async/await, type hints everywhere
- **Frontend**: TypeScript strict, function components
- **Imports**: Explicit only (no wildcards)
- **Dependency Flow**: Features depend on core, never reverse. Features expose public APIs via `__init__.py`.

# Database Management

**⚠️ ALWAYS use raw SQL** for schema changes (`backend/init_database.sql`)
The database schema is defined in `backend/init_database.sql`.

**Schema Changes Workflow:**

1. Update SQLAlchemy models in `backend/app/features/*/models.py`
2. Update `backend/init_database.sql` with SQL
3. Apply locally (`psql -f init_database.sql`)

# Constraints

- ❌ **NEVER** Commit API keys/secrets
- ❌ **NEVER** Modify Riot API rate limiting
- ❌ **NEVER** Skip pre-commit hooks
- ❌ **NEVER** Let SQLAlchemy auto-create tables (use init_database.sql)
- ❌ **NEVER** Edit `.env` directly (use `.env.example` as template)

# Detailed Documentation

- `backend/AGENTS.md`: Backend patterns, Riot API
- `frontend/AGENTS.md`: Frontend patterns, shadcn/ui
- `docs/database_overhaul.md`: Database changes tracking

---

**Instruction for AI Agents**:
When completing a task that involves changes to the codebase, always end your response with a concise overview/summarization of the changes made. Include reasoning for any unintuitive changes or significant modifications that the user didn't explicitly ask for but were necessary for the solution. This summary should help the user understand exactly what was done and why.

**Troubleshooting**:
If you encounter errors or bugs during task execution, AUTO-CHECK `logs/backend.log` and `logs/frontend.log` first. These logs often contain critical tracebacks (e.g., `NameError`, `ImportError`, `429 Too Many Requests`) that are not visible in the API response or UI output.

## Code Quality Standards

- **Clean Code**: Remove "thinking comments" or notes to self from the final code logic.
  - ❌ `// Wait, if I hide non-met thresholds, then what?`
  - ❌ `# User said "total_damage_dealt way bigger than total_damage_dealt_to_champions"`
  - ✅ Write imperative comments explaining _why_ complex logic exists, not the thought process that led to it.

## Quality Assurance

- **Static Analysis**: After modifying any Backend (Python) or Frontend (TypeScript/React) file, you MUST run the `get_errors` tool on that file.
  - If errors are reported (e.g., SyntaxError, TypeScript type errors), you MUST fix them before completing the task.
  - Do not assume "it looks correct" - verify with the tool.
