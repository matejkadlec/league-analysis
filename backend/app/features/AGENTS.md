# Features (`app/features/`)

> **Keep this file updated** when adding or modifying features.

Domain-specific business logic organized by feature. Each feature is self-contained.

## Existing Features

| Feature                 | Description                                             |
| ----------------------- | ------------------------------------------------------- |
| `auth/`                 | User authentication, JWT                                |
| `players/`              | Search, tracking, rank info                             |
| `matches/`              | Match history, stats                                    |
| `playstyle_analysis/`   | Playstyle analysis                                      |
| `matchmaking_analysis/` | Fairness evaluation                                     |
| `jobs/`                 | Background tasks ([see jobs/AGENTS.md](jobs/AGENTS.md)) |
| `settings/`             | Runtime config, API key                                 |

## Standard Structure

```
features/<feature_name>/
├── __init__.py          # Public API exports
├── router.py            # FastAPI routes
├── service.py           # Business logic
├── models.py            # Database models
├── schemas.py           # Pydantic schemas
└── dependencies.py      # DI helpers
```

## Patterns

### Router (Thin Controller)

```python
@router.get("/players/{puuid}")
async def get_player(
    puuid: str,
    player_service: PlayerService = Depends(get_player_service)
):
    return await player_service.get_player(puuid)
```

### Service (Business Logic)

```python
class PlayerService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_player(self, puuid: str) -> Player | None:
        result = await self.db.execute(
            select(Player).where(Player.puuid == puuid)
        )
        return result.scalar_one_or_none()
```

### Dependencies

```python
async def get_player_service(
    db: AsyncSession = Depends(get_db),
) -> PlayerService:
    return PlayerService(db)
```

## Rules

- Features depend on `core/`, optionally on other features
- Minimize cross-feature dependencies
- Features expose public APIs via `__init__.py`
- Keep routes thin, logic in services
