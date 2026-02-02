# Jobs Feature

> **Keep this file updated**: When modifying jobs, update this documentation.

Background task scheduling with APScheduler. See [docs/jobs.md](../../../../docs/jobs.md) for detailed job documentation.

## Structure

| File                | Purpose                                           |
| ------------------- | ------------------------------------------------- |
| `base.py`           | `BaseJob` abstract class with metrics and logging |
| `scheduler.py`      | APScheduler setup and lifecycle                   |
| `service.py`        | Job management (start/stop/status)                |
| `router.py`         | REST endpoints (`/api/jobs`)                      |
| `error_handling.py` | `@handle_riot_api_errors` decorator               |
| `log_capture.py`    | Execution log capture                             |
| `implementations/`  | Concrete job implementations                      |

## Current Jobs

| Job           | File                               | Schedule     |
| ------------- | ---------------------------------- | ------------ |
| Match Fetcher | `implementations/match_fetcher.py` | Configurable |

## Job States

`PENDING` → `IN_PROGRESS` → `COMPLETED` / `FAILED` / `RATE_LIMITED`

## Creating a New Job

```python
from app.features.jobs.base import BaseJob

class MyJob(BaseJob):
    async def execute(self, db: AsyncSession) -> None:
        self.metrics["records_processed"] = 0
        # Job logic...
        self.metrics["records_processed"] += 1
```

Register in `scheduler.py` and add `JobConfiguration` in database.
