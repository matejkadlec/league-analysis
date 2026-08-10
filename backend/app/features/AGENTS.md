# Features (`app/features/`)

> **Scope:** Backend domain-feature organization and shared conventions under
> `backend/app/features/`.
>
> **Maintenance:** Update when feature boundaries, standard structure,
> dependency rules, or the feature inventory changes.

Inherits repository-wide rules from [`../../../AGENTS.md`](../../../AGENTS.md)
and backend rules from [`../../AGENTS.md`](../../AGENTS.md).

Domain-specific business logic organized by feature. Each feature is self-contained.

## Existing Features

| Feature                 | Description                                             |
| ----------------------- | ------------------------------------------------------- |
| `auth/`                 | User auth, JWT revocation blacklist, refresh rotation, lockout, adaptive CAPTCHA, self-service email updates, password changes with current-password verification, cookie-consent audit persistence, public Join Us contact flow with subject counters and IP anti-spam |
| `players/`              | Shared canonical player data plus authenticated per-user current/tracked context |
| `matches/`              | Match history, stats                                    |
| `playstyle_analysis/`   | Playstyle analysis                                      |
| `matchmaking_analysis/` | Persisted, idempotent, cancellable fairness-analysis lifecycle |
| `jobs/`                 | Background tasks ([see jobs/AGENTS.md](jobs/AGENTS.md)) |
| `settings/`             | Runtime config, API key, remaining application settings, viewer-owned versioned card preferences |

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
- Player records, matches, and freshness timestamps remain shared by PUUID.
  Current selection, tracked mappings, and recent ordering are always scoped by
  authenticated application user ID. Never infer one from the other.
- Keep routes thin, logic in services
- Matchmaking Analysis start routes must return the persisted active run before
  Riot preflight/work begins. Preserve its explicit lifecycle states, one-active-
  run-per-PUUID database constraint, exact-run cancellation, and shared
  rate-limiter/maintenance boundaries. Any `AuthenticationError` or
  `ForbiddenError`, including during optional cache filling, must terminate with
  `error_code=RIOT_API_KEY_INVALID` so the shared frontend credential warning
  survives the background-run HTTP 200 polling boundary.
