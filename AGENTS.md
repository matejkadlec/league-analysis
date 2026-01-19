# Quick Start

**Environment**: WSL, PostgreSQL 18 on localhost:5432, database `league-analysis`, user `admin`**Environment**: WSL (Windows Subsystem for Linux), PostgreSQL 18 on localhost:5432

```bash**Database**: `league-analysis`(user:`admin`, password in .env)

./run.sh # Start backend + frontend (hot reload)

tail -f logs/backend.log # View logs**Start development**:

tail -f logs/frontend.log

````bash

./run.sh                    # Hot reload enabled (backend + frontend)

**Services**: Backend http://localhost:8000 (/api), Frontend http://localhost:3000```



**⚠️ CRITICAL**: After editing `.env`, restart `run.sh` (reads env vars on startup)**Services**:



# Tech Stack- Backend: http://localhost:8000 (API docs: /api)

- Frontend: http://localhost:3000

- **Backend**: FastAPI, SQLAlchemy 2.0, PostgreSQL, Python 3.13, uv- PostgreSQL: localhost:5432

- **Frontend**: Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS 4, shadcn/ui

- **Data**: TanStack Query, Zod, Axios, Riot Games API**Logs**:



# Structure```bash

tail -f logs/backend.log

## Backend (`backend/app/`)tail -f logs/frontend.log

- `core/`: Infrastructure (database, config, Riot API, enums)```

- `features/`: Domain features (players, matches, jobs, player_analysis, matchmaking_analysis, settings)

  - Each: `router.py`, `service.py`, `models.py`, `schemas.py`, `dependencies.py`**Stop**: `Ctrl+C` in terminal running `run.sh`



## Frontend (`frontend/`)**⚠️ CRITICAL**: After editing `.env`, you MUST restart `run.sh` (it reads env vars on startup)

- `app/`: Next.js pages

- `features/`: Domain UI (players, matches, jobs, player-analysis, matchmaking, settings)# Tech Stack

- `components/`: Shared layout + shadcn/ui

- `lib/core/`: API client, schemas, validations**Backend**: FastAPI, SQLAlchemy 2.0, PostgreSQL, Python 3.13, uv package manager

**Frontend**: Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS 4, shadcn/ui

# Code Rules**API**: Riot Games API integration

**Data**: TanStack Query, Zod validation, Axios

- **Backend**: async/await, type hints everywhere

- **Frontend**: TypeScript strict, function components# Structure

- **Imports**: Explicit only (no wildcards)

- **Features depend on core**, never reverse## Backend (Feature-Based Architecture)

- Features expose public APIs via `__init__.py` / `index.ts`

- `backend/app/core/`: Infrastructure (database, config, Riot API client, shared enums)

**Import patterns**:- `backend/app/features/`: Domain features

```python  - `features/players/`: Player management (search, tracking, rank info)

# Backend  - `features/matches/`: Match data and statistics

from app.features.players import PlayerService, Player  - `features/player_analysis/`: Player analysis algorithms

from app.core.database import get_db  - `features/matchmaking_analysis/`: Matchmaking fairness evaluation

from app.core.riot_api import RiotDataManager  - `features/jobs/`: Background job scheduling and execution

```  - `features/settings/`: System configuration management

```typescript  - Each feature contains: `router.py`, `service.py`, `models.py`, `schemas.py`, `dependencies.py`

// Frontend

import { PlayerSearch } from '@/features/players'## Frontend (Feature-Based Architecture)

import { api } from '@/lib/core/api'

```- `frontend/app/`: Next.js pages (App Router)

- `frontend/features/`: Feature modules

# Database  - `features/players/`: Player components, hooks, utilities

  - `features/matches/`: Match components

**⚠️ ALWAYS use raw SQL** for schema changes (`backend/init_database.sql`)  - `features/player-analysis/`: Analysis components

  - `features/matchmaking/`: Matchmaking analysis components

```bash  - `features/jobs/`: Job management components

# Schema workflow:  - `features/settings/`: Settings components

# 1. Update models in backend/app/features/*/models.py- `frontend/components/`: Shared layout components and shadcn/ui

# 2. Update backend/init_database.sql with SQL- `frontend/lib/core/`: Core utilities (API client, schemas, validations)

# 3. Apply locally:

cd backend && PGPASSWORD="{read from .env}" psql -h localhost -U admin -d league-analysis -f init_database.sql# Code Style



# Connect to DB:- **Backend**: async/await, type hints, FastAPI patterns

PGPASSWORD="{read from .env}" psql -h localhost -U admin -d league-analysis- **Frontend**: TypeScript, function components with hooks

- **General**: Explicit imports, no .env edits

# Common operations:

\dt auth.*                  # List auth tables## Feature Organization

\dt core.*                  # List core tables

\dt jobs.*                  # List jobs tables- **Core vs. Features**: Infrastructure code in `core/`, domain code in `features/`

\d table_name               # Describe table- **Dependency Flow**: Features depend on core, never the reverse

```- **Public API**: Features expose public APIs through `__init__.py` exports

- **Import Examples**:

# Constraints

  ```python

❌ **NEVER**:  # Backend - import from features

- Commit API keys/secrets  from app.features.players import PlayerService, Player, PlayerResponse

- Modify Riot API rate limiting  from app.core.database import get_db

- Skip pre-commit hooks  from app.core.riot_api import RiotAPIClient

- Let SQLAlchemy auto-create tables (use init_database.sql)

- Edit `.env` directly (use `.env.example` as template)  # Frontend - import from features

  import { PlayerSearch } from '@/features/players'

✅ **ALWAYS**:  import { api } from '@/lib/core/api'

- Use raw SQL for schema changes  ```

- Update both init_database.sql AND local database

- Run pre-commit hooks# Database Management

- Use type hints (Python) and strict types (TypeScript)

- Keep features isolated**Use raw SQL** for all database schema changes. The database schema is defined in `backend/init_database.sql`.



# See Also```bash

# Initialize database (first time setup)

- `backend/AGENTS.md`: Backend patterns, Riot APIcd backend && PGPASSWORD="$POSTGRES_PASSWORD" psql -h localhost -U admin -d league-analysis -f init_database.sql

- `backend/init_database.sql`: Database schema

- `frontend/AGENTS.md`: Frontend patterns, shadcn/ui# Connect to database

PGPASSWORD="$POSTGRES_PASSWORD" psql -h localhost -U admin -d league-analysis

# Common operations
\dt auth.*                    # List auth schema tables
\dt core.*                    # List core schema tables
\dt jobs.*                    # List jobs schema tables
\d table_name                 # Describe table structure
```

**Schema Changes:**

1. Update SQLAlchemy models in `backend/app/features/*/models.py`
2. Add corresponding SQL to `backend/init_database.sql`
3. Apply changes manually via psql or SQL script
4. Test thoroughly before committing

**Important**: Database changes must be coordinated. Always update both the init script and apply changes to your local database.

# Constraints

- ❌ Don't commit API keys or secrets
- ❌ Don't modify Riot API rate limiting
- ❌ Don't touch legacy code without explicit request
- ❌ Don't skip pre-commit hooks (always run checks before committing)
- ❌ Don't let SQLAlchemy auto-create tables (use init_database.sql)

# Detailed Documentation

- `backend/AGENTS.md`: Riot API integration and FastAPI patterns
- `backend/init_database.sql`: Database schema definition
- `frontend/AGENTS.md`: Next.js patterns and shadcn/ui
````
