# FastAPI App (`backend/app/`)

## Structure

```
app/
├── main.py              # App init, router registration, lifecycle
├── core/                # Infrastructure
└── features/            # Domain features
```

## main.py

**Handles**:

- FastAPI app creation, CORS, middleware
- Router registration from features
- Startup/shutdown (database, scheduler)
- Health check endpoint

**Router registration**:

```python
from app.features.players import players_router
app.include_router(players_router, prefix="/api/v1", tags=["players"])
```

## Rules

**Core vs Features**:

- Core = infrastructure (database, config, Riot API, enums, exceptions)
- Features = domain logic (players, matches, etc.)
- Features depend on core, **core NEVER depends on features**

**Imports**:

```python
# Core
from app.core.database import get_db
from app.core.riot_api import RiotDataManager

# Features (public API)
from app.features.players import PlayerService, Player

# Features (direct - for internal use)
from app.features.players.service import PlayerService
```

**Dependency injection**:

```python
from fastapi import Depends
from app.core.database import get_db

@router.get("/example")
async def example(db: AsyncSession = Depends(get_db)):
    pass
```

## Add New Feature

1. Create `app/features/my_feature/`
2. Add standard files: `__init__.py`, `router.py`, `service.py`, `models.py`, `schemas.py`, `dependencies.py`
3. Register router in `main.py`:
   ```python
   from app.features.my_feature import my_feature_router
   app.include_router(my_feature_router, prefix="/api/v1", tags=["my_feature"])
   ```
