# Jobs Feature (`features/jobs/`)

Background task scheduling with APScheduler. **Unique architecture** - has subdirectories for job implementations and utilities.

## Structure

```
jobs/
├── __init__.py
├── router.py               # Job control endpoints
├── service.py              # Job management logic
├── models.py               # JobConfiguration, JobExecution
├── schemas.py
├── dependencies.py
├── base.py                 # BaseJob abstract class, job registry
├── scheduler.py            # APScheduler setup and lifecycle
├── error_handling.py       # @handle_riot_api_errors decorator
├── log_capture.py          # Execution log capture
├── apscheduler_models.py   # APScheduler table metadata
└── implementations/        # Concrete job implementations
    ├── tracked_player_updater.py    # Every 15 min
    ├── match_fetcher.py             # Every 30 min
    ├── player_analyzer.py           # Daily
    └── ban_checker.py               # Daily
```

## Job Types

1. **Tracked Player Updater** - Updates tracked player data (15 min)
2. **Match Fetcher** - Fetches new matches (30 min)
3. **Player Analyzer** - Runs player analysis (daily)
4. **Ban Checker** - Checks for banned accounts (daily)

## Job States

- `PENDING` - Scheduled
- `IN_PROGRESS` - Executing
- `COMPLETED` - Success
- `FAILED` - Error occurred
- `RATE_LIMITED` - Riot API rate limit hit

## BaseJob Pattern

All jobs inherit from `BaseJob`:

```python
from app.features.jobs.base import BaseJob

class MyJob(BaseJob):
    job_id = "my_job"
    name = "My Job"

    async def execute(self, db: AsyncSession) -> None:
        # Job logic here
        logger.info("job_executed", job_id=self.job_id)
```

## Error Handling

Use `@handle_riot_api_errors` decorator for Riot API calls:

```python
from app.features.jobs.error_handling import handle_riot_api_errors

class MyJob(BaseJob):
    @handle_riot_api_errors
    async def execute(self, db: AsyncSession) -> None:
        # Automatically handles rate limits and retries
        await self.riot_data_manager.get_summoner(puuid, platform, db)
```

## Job Lifecycle

```
PENDING → IN_PROGRESS → COMPLETED / FAILED / RATE_LIMITED
```

Logs captured automatically and stored in `JobExecution` records.
