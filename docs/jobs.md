# Background Jobs Documentation

> **Authority:** Background job types, scheduler lifecycle, execution state,
> runtime controls, persistence, and administrator API behavior.
>
> **Maintenance:** Update when a job implementation, schedule default,
> configuration, scheduler/recovery path, control endpoint, or execution model
> changes.

## Overview

Jobs are automated background tasks that run on a schedule to keep player data up-to-date. They are managed by APScheduler and execute within their own database sessions.

### Job Architecture

```
JobScheduler (APScheduler)
    └── JobConfiguration (database)
            └── JobExecution (per-run tracking)
                    └── BaseJob (abstract class)
                            ├── MatchFetcherJob (implementation)
                            └── PlayerUpdaterJob (implementation)
```

**Key Components:**

- **JobConfiguration**: Database model storing job settings (schedule, enabled status, config_json)
- **JobExecution**: Tracks each job run (status, metrics, logs, timestamps)
- **BaseJob**: Abstract base class providing logging, metrics, and error handling
- **Scheduler**: APScheduler instance managing job triggers
- **User tracking source**: `auth.user_tracked_players` defines per-user tracked lists;
  jobs process the union of tracked `puuid` values across all users.

### Startup Behavior

When the backend starts, the scheduler automatically:

1. **Cancels stale jobs** - Any executions left in `RUNNING` or `PAUSED` by an
   ungraceful shutdown are marked `CANCELLED`, and persisted pause flags are reset
2. **Detects overdue jobs** - Checks if any active jobs haven't run within their configured interval
3. **Runs overdue jobs immediately** - Executes all overdue jobs in parallel to catch up
4. **Schedules regular execution** - Sets up future job triggers based on configured intervals

This ensures the system automatically recovers from downtime without manual intervention.

### Access Control

- `/api/v1/jobs` API endpoints are **admin-only** (`is_admin=true`)
- Non-admin users are redirected away from the `/jobs` frontend page and cannot
  trigger jobs through API calls

### Persistence and Execution States

- `jobs.job_configurations` stores job type, schedule, active/pause state, and
  job-specific `config_json`.
- `jobs.job_executions` stores each run's status, trigger source, execution
  type, metrics, errors, API-key error flag, and structured logs.
- `jobs.apscheduler_jobs` is APScheduler's persistent job store.
- Execution lifecycle is:
  `PENDING` -> `RUNNING` <-> `PAUSED` ->
  `SUCCESS` / `FAILED` / `CANCELLED` / `RATE_LIMITED`.

### Runtime Controls

Runtime control has two layers:

1. `control.py` owns the in-memory registry for running tasks and graceful or
   forced stop requests.
2. `jobs.job_configurations.is_paused` persists the current pause request so
   an execution observes it at its next `check_control_state()` checkpoint.

A graceful stop raises `JobStopSignal` at a checkpoint. A force stop cancels
the registered asyncio task. Pause loops poll once per second, remain
stop-aware, set the execution to `PAUSED`, and restore it to `RUNNING` on
resume. Stop paths clear the persisted pause state.

The reviewed local Riot-data cleanup command can also persist
`config_json.riot_maintenance_mode` on Match Fetcher and Player Updater
configurations. Regular executions check that interlock after loading fresh
configuration and record `CANCELLED` before any gameplay-data write; non-writing
`TEST` executions are not blocked. Configuration updates preserve an active
interlock. Cleanup enables it only after it has locked the job tables and
refused existing `RUNNING`/`PAUSED` regular writers, and the explicit cleanup
resume command is the only supported way to remove it.

During a live process, service/base cleanup marks a database execution
`FAILED` when it claims to be running but has no corresponding in-memory
control. On process startup, leftover `RUNNING`/`PAUSED` executions are instead
marked `CANCELLED` because the process was interrupted.

### Administrator API Surface

All routes below are under `/api/v1/jobs`:

| Route | Responsibility |
| --- | --- |
| `GET /` | List configurations |
| `PUT /{job_id}` | Update configuration and immediately synchronize APScheduler |
| `GET /{job_id}/executions` | Paginated execution history for one job |
| `GET /executions/all` | Paginated execution history across jobs |
| `POST /{job_id}/trigger` | Start a regular manual run |
| `GET /{job_id}/control-state` | Read running/pause/stop state |
| `POST /{job_id}/pause` | Pause a regular run at its next checkpoint |
| `POST /{job_id}/resume` | Resume a paused regular run |
| `POST /{job_id}/stop?force={bool}` | Request graceful or forced stop |
| `POST /{job_id}/test?suspend_regular={bool}` | Start a non-writing test run |
| `POST /{job_id}/test/pause` | Pause a test run |
| `POST /{job_id}/test/resume` | Resume a test run |
| `POST /{job_id}/test/stop?force={bool}` | Stop a test run |
| `GET /status/overview` | Scheduler, active-job, running-execution, and latest-run summary |
| `POST /sync-player/{puuid}` | Trigger a focused player synchronization |
| `GET /running-status` | Read lightweight running state |

### Test Runs

Test runners call the Riot endpoints used by their regular job once per minute
for at most 60 iterations (one hour). They use `ExecutionType.TEST`, a negative
job-configuration ID as the runtime key, and the first tracked player or
`TEST_PUUID` fallback. Gameplay data is not written; the execution record is
the only intended persistence.

`suspend_regular=true` pauses the APScheduler entry for the duration and
resumes it in cleanup. A regular manual trigger force-stops an active test run
of the same job before the real run starts.

---

## Match Fetcher Job

- **Job Type:** `MATCH_FETCHER`
- **Default schedule:** Every 1 hour (`3600` seconds; configurable)
- **Purpose:** Fetch new matches for tracked players (configurable queues) and
  update Solo/Duo rank snapshots.

### Workflow

```
For each tracked player:
1. sync_matches_for_player()
   ├── For each enabled queue in config_json.enabled_queue_ids:
   │   ├── Fetch match IDs from Riot API (batches of 100)
   │   ├── Filter out already-analyzed matches
   │   ├── For each new match:
   │   │   ├── Sleep 1.2s (rate limit protection)
   │   │   ├── Fetch full match details
   │   │   ├── Fetch match timeline
   │   │   ├── Skip if not Season 16 (game_version != "16.*")
   │   │   └── Store/update match, participants, and timeline aggregates
   └── Commit changes

2. update_player_league()  # Solo/Duo snapshots only
   ├── Call /lol/league/v4/entries/by-puuid/{puuid}
   ├── Select RANKED_SOLO_5x5 entry only
   ├── Compare with latest record in core.player_leagues
   ├── If different: Create new rank record
   └── Commit changes
```

### Riot API Calls Made

| Endpoint                                         | Parameters                                                         | Purpose                                              |
| ------------------------------------------------ | ------------------------------------------------------------------ | ---------------------------------------------------- |
| `GET /lol/match/v5/matches/by-puuid/{puuid}/ids` | `start=0, count=100, queue in [420, 440, 400, 450]` (enabled only) | Get queue-specific match IDs                         |
| `GET /lol/match/v5/matches/{matchId}`            | -                                                                  | Get full match details                               |
| `GET /lol/match/v5/matches/{matchId}/timeline`   | -                                                                  | Get timeline events for objective aggregates         |
| `GET /lol/league/v4/entries/by-puuid/{puuid}`    | -                                                                  | Get current ranked entries (Solo used for snapshots) |

### Rate Limiting Strategy

- **Strict throttling**: 1.2 second delay between match detail requests
- **Cross-component coordination**: `DBRateLimiter` uses
  `RateLimitComponent.MATCH_FETCHER`
- This respects the Development API Key limit of 100 requests/2 minutes
- Rate limit errors (`429`) trigger `RateLimitSignal`, causing graceful job termination with `RATE_LIMITED` status

### Error Handling

| Error Type                               | Behavior                                                |
| ---------------------------------------- | ------------------------------------------------------- |
| `RateLimitError`                         | Convert to `RateLimitSignal`, job terminates gracefully |
| `AuthenticationError` / `ForbiddenError` | Job fails immediately (API key invalid/expired)         |
| Match fetch error                        | Logged, skip that match, continue with others           |
| Player processing error                  | Logged, skip that player, continue with others          |
| Rank update error                        | Logged, does not fail the job                           |

### Database Tables Updated

- **core.matches**: Match metadata (timestamps, duration, queue, etc.)
- **core.match_participants**: Full participant data including stats, items, runes
- **core.match_timelines**: Objective timeline aggregates per participant
- **core.players**: Minimal participant records for missing players
- **core.player_leagues**: New Solo/Duo snapshot if rank has changed

### Season Filtering

The job only processes matches from the current season (Season 16). It checks `game_version.startsWith("16.")` and stops fetching when it encounters older matches.

### Metrics Tracked

- `records_created`: Number of new matches stored
- `api_requests_made`: Total Riot API calls
- `records_updated`: Updated match/player records

### Configuration

In `jobs.job_configurations` table:

```json
{
  "job_type": "MATCH_FETCHER",
  "name": "Match Fetcher",
  "schedule": "3600",
  "config_json": {
    "interval_seconds": 3600,
    "enabled_queue_ids": [420, 440, 400, 450]
  },
  "is_active": true
}
```

Queue meanings:

- `420` = Ranked Solo/Duo
- `440` = Ranked Flex
- `400` = Normal Draft
- `450` = ARAM

Active-state behavior:

- If `enabled_queue_ids` is empty, Match Fetcher `is_active=false`
- If at least one queue is enabled, Match Fetcher `is_active=true`

### Execution Flow

1. Scheduler triggers job based on `interval_seconds`
2. Job creates `JobExecution` record with `RUNNING` status
3. Retrieves API key (database priority, then env fallback)
4. Gets globally tracked players (distinct `puuid` tracked by any user)
5. Processes each player (match sync + rank update)
6. Updates `JobExecution` with final status, metrics, and logs
7. Commits all changes

### Common Issues

| Issue                                    | Cause                            | Solution                                          |
| ---------------------------------------- | -------------------------------- | ------------------------------------------------- |
| "2 validation errors for LeagueEntryDTO" | Riot API changed response format | Update `LeagueEntryDTO` model fields              |
| Ranks not updating                       | Session commit missing           | Ensure `db.commit()` after `update_player_rank()` |
| Execution left in RUNNING after a crash  | Ungraceful shutdown               | Restart cleanup marks it `CANCELLED`; inspect logs |
| No matches fetched                       | All matches already analyzed     | Expected behavior if no new games                 |

---

## Player Updater Job

- **Job Type:** `PLAYER_UPDATER`
- **Default schedule:** Every 24 hours (`86400` seconds; configurable)
- **Purpose:** Update player profile information (name, tag, icon, summoner
  level).

### Workflow

```
For each tracked player:
1. Fetch summoner data: /lol/summoner/v4/summoners/by-puuid/{puuid}
   ├── profile_icon_id
   └── summoner_level
2. Fetch account data: /riot/account/v1/accounts/by-puuid/{puuid}
   ├── game_name
   └── tag_line
3. Update player record if any field changed
```

### API Endpoints Used

- `/lol/summoner/v4/summoners/by-puuid/{puuid}` - Summoner profile data
- `/riot/account/v1/accounts/by-puuid/{puuid}` - Riot account data

### Configuration

```json
{
  "job_type": "PLAYER_UPDATER",
  "name": "Player Updater",
  "schedule": "86400",
  "config_json": {
    "interval_seconds": 86400
  },
  "is_active": true
}
```

### Metrics Tracked

- `records_updated`: Number of player profiles updated
- `api_requests_made`: Total Riot API calls (2 per player)

---

## API Key Handling

The system retrieves the Riot API key with database priority:

1. Select the newest active, non-expired key in `core.riot_api_keys`
2. Fall back to `RIOT_API_KEY` from `.env` when no valid database key exists

**When API Key is Invalid:**

- First API call returns `401 Unauthorized` or `403 Forbidden`
- Job raises `AuthenticationError`
- Job terminates with `FAILED` status
- `jobs.job_executions.has_api_key_error` is stored as `true` for the failed run
- Error logged: "Authentication failure during {operation}"
- Frontend header warning (red banner) is triggered when latest execution in
  `/api/v1/jobs/status/overview` is `FAILED` with `has_api_key_error=true` and no
  newer successful key validation/save has occurred in the active session

**Resolution:** Update API key in Settings page or `.env` file
