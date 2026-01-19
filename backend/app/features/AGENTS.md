# Features (`app/features/`)

Domain-specific business logic organized by feature. Each feature is self-contained.

## Existing Features

- `players/` - Search, tracking, rank info
- `matches/` - Match history, stats
- `player_analysis/` - Smurf detection (see feature AGENTS.md)
- `matchmaking_analysis/` - Fairness evaluation
- `jobs/` - Background tasks (see feature AGENTS.md)
- `settings/` - Runtime config

## Standard Structure

```
features/<feature_name>/
├── __init__.py          # Public API exports
├── router.py            # FastAPI routes
├── service.py           # Business logic
├── models.py            # Database models (optional)
├── schemas.py           # Pydantic schemas
├── dependencies.py      # DI helpers
└── tests/               # Tests
```

## File Responsibilities

### `__init__.py` - Public API

```python
from .router import router as players_router
from .service import PlayerService
from .models import Player, Rank
from .schemas import PlayerResponse

__all__ = ["players_router", "PlayerService", "Player", "Rank", "PlayerResponse"]
```

### `router.py` - API Endpoints

Thin controllers that delegate to services:

```python
from fastapi import APIRouter, Depends
from .dependencies import get_player_service
from .schemas import PlayerResponse

router = APIRouter()

@router.get("/players/{puuid}", response_model=PlayerResponse)
async def get_player(
    puuid: str,
    player_service: PlayerService = Depends(get_player_service)
):
    player = await player_service.get_player(puuid)
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")
    return player
```

**Keep routes thin** - no business logic in handlers.

### `service.py` - Business Logic

```python
import structlog
from app.core.riot_api import RiotDataManager

logger = structlog.get_logger()

class PlayerService:
    def __init__(self, riot_data_manager: RiotDataManager):
        self.riot_data_manager = riot_data_manager

    async def get_player(self, puuid: str, db: AsyncSession) -> Player | None:
        result = await db.execute(select(Player).where(Player.puuid == puuid))
        return result.scalar_one_or_none()
```

**Guidelines**:

- Async methods only
- Use RiotDataManager for Riot API calls
- Log with structlog context keys
- Return early to reduce complexity

### `models.py` - Database Models

```python
from sqlalchemy import Column, String, Integer, Boolean
from app.core.models import BaseModel

class Player(BaseModel):
    __tablename__ = "players"

    puuid = Column(String, unique=True, nullable=False, index=True)
    game_name = Column(String, nullable=False)
    tag_line = Column(String, nullable=False)
    is_tracked = Column(Boolean, default=False)
```

### `schemas.py` - Pydantic Schemas

```python
from pydantic import BaseModel

class PlayerResponse(BaseModel):
    puuid: str
    game_name: str
    tag_line: str

    class Config:
        from_attributes = True
```

### `dependencies.py` - DI

```python
from app.core.dependencies import get_riot_data_manager

def get_player_service(
    riot_dm: RiotDataManager = Depends(get_riot_data_manager)
) -> PlayerService:
    return PlayerService(riot_dm)
```

## Rules

- Features depend on `core/`, optionally on other features
- Minimize cross-feature dependencies
- Features expose clean public APIs via `__init__.py`
- Keep features isolated and modular
