# Jobs Feature

> **Keep this file updated**: When modifying jobs, update this documentation.

Background task scheduling with APScheduler. See [docs/jobs.md](../../../../docs/jobs.md) for detailed job documentation.

## Structure

| File                | Purpose                                                                |
| ------------------- | ---------------------------------------------------------------------- |
| `base.py`           | `BaseJob` abstract class with metrics, logging, and pause/stop control |
| `control.py`        | In-memory runtime control registry (pause/resume/stop state)           |
| `scheduler.py`      | APScheduler setup and lifecycle                                        |
| `service.py`        | Job management (CRUD, status, pause/stop actions, orphan cleanup)      |
| `router.py`         | Admin-only REST endpoints (`/api/jobs`)                                |
| `error_handling.py` | `@handle_riot_api_errors` decorator                                    |
| `log_capture.py`    | Execution log capture                                                  |
| `implementations/`  | Concrete job implementations (regular + test runners)                  |

## Current Jobs

| Job            | File                                | Schedule   |
| -------------- | ----------------------------------- | ---------- |
| Match Fetcher  | `implementations/match_fetcher.py`  | 15 minutes |
| Player Updater | `implementations/player_updater.py` | 24 hours   |

## Test Runs

Test runs call all Riot API endpoints a real job uses once per minute without writing any
data to the database (except the execution record itself). They are useful for verifying
API health and testing pause/stop functionality.

### Implementation

| File                             | Purpose                                                  |
| -------------------------------- | -------------------------------------------------------- |
| `implementations/test_runner.py` | `TestMatchFetcherJob` and `TestPlayerUpdaterJob` classes |

### Behavior

- **Runtime key**: Test runs use `-job_config_id` as their runtime control key to avoid
  conflicts with regular runs (which use positive `job_config_id`).
- **Execution type**: `ExecutionType.TEST` — stored in `jobs.job_executions.execution_type`.
- **Player selection**: Uses the first tracked player, or falls back to `TEST_PUUID` from
  `app/core/config.py`.
- **Rate limiter priority**: Lowest (same as matchmaking analysis).
- **Max duration**: 60 iterations × 60 seconds = 1 hour.
- **Interruptible wait**: Sleep between iterations is 60 × `asyncio.sleep(1)` with a
  `check_control_state()` check each tick, enabling responsive pause/stop.
- **Conflict handling**: When a regular manual trigger fires, any active test run for that
  job is force-stopped automatically.
- **Suspend regular**: The test trigger endpoint accepts `?suspend_regular=true` to pause
  the APScheduler job during the test (auto-resumed when the test finishes).

### API Endpoints

| Endpoint                                               | Action                                      |
| ------------------------------------------------------ | ------------------------------------------- |
| `POST /api/v1/jobs/{job_id}/test`                      | Start a test run                            |
| `POST /api/v1/jobs/{job_id}/test?suspend_regular=true` | Start a test run and suspend scheduled runs |
| `POST /api/v1/jobs/{job_id}/test/stop`                 | Stop a running test                         |

### Frontend

- **FlaskConical icon button** on each job card header (rightmost position)
- Clicking opens a confirmation dialog: "Suspend regular runs? Yes / No / Cancel"
- While running, the button shows a Square (stop) icon; clicking it stops the test
- **Optimistic UI**: Button state updates immediately, not waiting for 15s poll
- **Executions table**: "Type" column between "Job Name" and "Status" shows Regular/Test badge
- Test executions show "Test run — no records created or updated" in the statistics column

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

## Runtime Controls (Pause / Stop)

Jobs support runtime pause, resume, and stop while executing. This is implemented as a
two-layer system:

### Architecture

1. **In-memory runtime controls** (`control.py`) — Source of truth for "is a job actually
   running right now?". A `RuntimeJobControl` object is registered when a job starts and
   unregistered when it finishes. Contains `stop_requested` / `force_stop_requested` flags.
2. **Database state** (`jobs.job_configurations.is_paused`) — Persists the paused flag so
   it survives across `check_control_state` polls. Reset automatically when a stop is
   requested.

### Control Checkpoints

Jobs call `await self.check_control_state(db)` at loop boundaries (e.g., before processing
each tracked player). This method:

- Raises `JobStopSignal` if stop/force-stop was requested
- Blocks in a 1-second poll loop while the job is paused, checking for stop signals each iteration

### API Endpoints

| Endpoint                                     | Action                                                                |
| -------------------------------------------- | --------------------------------------------------------------------- |
| `POST /api/v1/jobs/{job_id}/pause`           | Set `is_paused = True` in DB; job blocks at next checkpoint           |
| `POST /api/v1/jobs/{job_id}/resume`          | Set `is_paused = False`; unblocks the paused loop                     |
| `POST /api/v1/jobs/{job_id}/stop`            | Graceful stop — `JobStopSignal` at next checkpoint                    |
| `POST /api/v1/jobs/{job_id}/stop?force=true` | Force stop — cancels the asyncio task immediately                     |
| `GET  /api/v1/jobs/{job_id}/control-state`   | Returns `is_running`, `is_paused`, `is_stopping`, `is_force_stopping` |

### Stop Behavior

- **Graceful stop**: Sets `stop_requested` flag → `check_control_state` raises `JobStopSignal`
  → `run()` catches it, calls `log_completion(success=True)` with `stopped_early` log entry.
- **Force stop**: Calls `task.cancel()` → Python raises `asyncio.CancelledError` →
  `run()` catches it, attempts `log_completion(success=True)`.
- Both modes clear `is_paused` in the DB.

### Frontend Integration

The job card (`frontend/features/jobs/components/job-card.tsx`) shows:

- **Pause button** (top-right of card header) when the job is running and not stopping
- **Main button** cycles through: "Trigger Now" → "Running..." → "Paused" → "Stopping job..."
- Clicking "Running..." triggers graceful stop; clicking "Stopping job..." escalates to force stop

### Orphaned Execution Cleanup

If a RUNNING execution exists in the DB but has no corresponding in-memory runtime control
(e.g., due to a race condition or failed completion update), it is automatically cleaned up:

- `is_already_running()` in `base.py` detects and marks orphans as FAILED before starting
- `get_running_execution_count()` in `service.py` runs cleanup before counting
- Startup `_mark_stale_jobs_as_failed()` handles records left from ungraceful shutdowns

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
