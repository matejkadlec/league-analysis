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

| Job            | File                                | Schedule   |
| -------------- | ----------------------------------- | ---------- |
| Match Fetcher  | `implementations/match_fetcher.py`  | 15 minutes |
| Player Updater | `implementations/player_updater.py` | 24 hours   |

## Match Fetcher Queue Config

- Match Fetcher queue toggles are stored globally in `jobs.job_configurations.config_json.enabled_queue_ids`
- Supported queues: `420` (Solo/Duo), `440` (Flex), `400` (Normal Draft), `450` (ARAM)
- If `enabled_queue_ids` is missing/invalid, backend defaults to all queues enabled
- If `enabled_queue_ids` is empty, `is_active` is auto-set to `false`
- Any `/jobs/{id}` update now triggers immediate scheduler sync (add/remove/reschedule) without restart
- Match Fetcher performs one extra Riot call per processed match:
  `/lol/match/v5/matches/{matchId}/timeline` and stores objective aggregates in
  `core.match_timelines`

## Job States

`PENDING` → `IN_PROGRESS` → `COMPLETED` / `FAILED` / `RATE_LIMITED`

## Startup Behavior

When the backend starts, the scheduler:

1. Marks any jobs stuck in `RUNNING` state as `FAILED` (from ungraceful shutdowns)
2. **Checks for overdue jobs** - runs jobs immediately if:
   - They have never run before, OR
   - Their last execution was longer ago than their configured interval
3. Runs overdue jobs in parallel (both Match Fetcher and Player Updater can run simultaneously)
4. Schedules all active jobs for future execution

This ensures jobs catch up automatically after server downtime without manual intervention.

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
