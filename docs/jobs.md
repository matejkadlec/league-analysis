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

Backend process shutdown stops APScheduler with `wait=False`: it stops future
dispatches but never drains Match Fetcher, Player Updater, tests, or other
long-running Riot work. A production restart therefore has a bounded shutdown
instead of waiting through provider rate-limit windows. The next startup uses
the recovery step above to mark interrupted `RUNNING`/`PAUSED` regular
executions `CANCELLED`; Matchmaking Analysis retains its separate persisted
cancellation/retry lifecycle. Deployment readiness never requires an idle job
queue.

### Access Control

- `/api/v1/jobs` API endpoints are **admin-only** (`is_admin=true`)
- Non-admin users are redirected away from the `/jobs` frontend page and cannot
  trigger jobs through API calls

### Persistence and Execution States

- `jobs.job_configurations` stores job type, schedule, active/pause state, and
  job-specific `config_json`.
- `jobs.job_executions` stores each run's status, trigger source, execution
  type, metrics, errors, API-key error flag, and structured logs.
- `jobs.player_sync_runs` stores the user-requested, per-PUUID Update lifecycle
  that coordinates one targeted Match Fetcher followed by one targeted Player
  Updater execution.
- `jobs.apscheduler_jobs` is APScheduler's persistent job store.
- Execution lifecycle is:
  `PENDING` -> `RUNNING` <-> `PAUSED` ->
  `SUCCESS` / `FAILED` / `CANCELLED` / `RATE_LIMITED`.

For the two regular writer jobs, isolated player, match, timeline, and
provider-response errors are recoverable: the job continues and finishes
`SUCCESS` with bounded warning diagnostics. A missing or Riot-rejected API key
finishes `FAILED`; rate exhaustion finishes `RATE_LIMITED`, and maintenance or
operator stops finish `CANCELLED`. Database failures and other execution-wide
faults still finish `FAILED` because continuing could corrupt or misreport
progress. Test runs retain fail-on-any-diagnostic semantics because they are
health checks rather than best-effort batch writers.

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
configurations. Regular scheduled executions check that interlock after loading
fresh configuration and record `CANCELLED` before any gameplay-data write.
Every direct Riot-data writer—account linking, player tracking or refresh,
match-history storage, and matchmaking analysis—acquires gameplay and job-table
locks in cleanup order, then re-reads the interlock before its core/auth write.
Non-writing `TEST` executions are not blocked. Job-configuration updates take
those same locks before their row lock; the administrator API cannot create or
clear the cleanup-owned key, but preserves it when echoing an active
configuration. Cleanup enables it only after it has locked the job tables,
refused existing `RUNNING`/`PAUSED` regular writers, and verified that both
writer types have exactly one configuration receiving the interlock; the
explicit cleanup resume command is the only supported way to remove it.

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
| `POST /sync-player/{puuid}` | Trigger the legacy admin synchronization endpoint |
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

### Explicit Per-Player Update Lifecycle

The authenticated player API exposes the non-admin Player Card update flow:

| Route | Responsibility |
| --- | --- |
| `POST /api/v1/players/{puuid}/sync` | Create or attach to the one active update for the exact PUUID |
| `GET /api/v1/players/{puuid}/sync/active` | Rehydrate an active update after navigation or reload |
| `GET /api/v1/players/{puuid}/sync/{sync_id}` | Poll the exact persisted lifecycle |

`jobs.player_sync_runs` uses `pending` -> `running` -> `completed`, `failed`,
`cancelled`, or `rate_limited`. A partial unique index on active PUUIDs makes
repeated starts attach to the same run. The orchestrator passes an exact PUUID
allowlist to Match Fetcher and Player Updater; it never expands an explicit
update into all tracked players. It reports `completed` only when both job
executions finish `SUCCESS` without recoverable warnings. Client-visible
errors are stable and safe; detailed provider diagnostics remain in the
underlying administrator execution records and server logs.

Client-visible failure codes are `RIOT_API_KEY_INVALID`, `RIOT_RATE_LIMITED`,
`SYNC_CANCELLED`, `SYNC_BUSY`, `SYNC_CONFIGURATION_MISSING`, `PLAYER_ID_STALE`,
and `SYNC_FAILED` as the unclassified fallback. `PLAYER_ID_STALE` means Riot
rejected the stored PUUID because it was issued to a different developer
account; searching for that player again resolves the current PUUID into a
separate row, which an operator then reconciles. Discovery never merges the two
rows automatically. See
[`riot-api.md`](riot-api.md#puuids-are-bound-to-the-developer-account).

A job that ends without recording completion — an exception raised while
collecting logs or writing the completion row, outside `execute()` — is closed
as `FAILED` in the run's `finally` block. Without that guard the execution row
stays `RUNNING` and the next scheduled tick reports it as an orphan.

`SYNC_BUSY` reports only a run the scheduler skipped because the same job was
already active. A run whose start failed also records no execution, but it is a
database failure rather than a competing update and stays `SYNC_FAILED`. The
cached terminal status is likewise published only once the completion write is
persisted, so a client never reads a status the database rejected.

Startup cancels every `pending`/`running` run left behind by a previous
process. The worker is in-process, so no such row can still be owned, and the
route hands back an existing active row instead of scheduling new work — an
orphaned row would otherwise block that player's updates. Matchmaking Analysis
is not cancelled at startup: its next explicit start resumes the persisted run
instead.

The frontend polls this lifecycle, then invalidates and refetches active query
keys containing that exact PUUID. The approved completion info toast is shown
once only after those refetches succeed. Switching current player never starts
this lifecycle on its own.

### Matchmaking Analysis Run Lifecycle

Matchmaking Analysis is an on-demand application run rather than an
APScheduler job, but it shares the database-backed Riot rate limiter and the
Riot-writer maintenance interlock with the scheduled writers.

`POST /api/v1/matchmaking-analysis/start` creates or attaches to one persisted
active run and returns immediately. It does not perform the Riot minimum-match
preflight or wait for analysis work in the HTTP request. The background worker
owns all provider calls, so a valid run may continue through multiple rate-limit
windows without being coupled to the frontend's normal request timeout.

`core.matchmaking_analyses.status` is authoritative:

`pending` -> `in_progress` <-> `waiting_rate_limit` ->
`completed` / `failed` / `cancelled`.

- A partial unique index permits only one active run per PUUID. Repeated starts
  return that run instead of creating duplicate work.
- `waiting_rate_limit` remains active and records `rate_limit_reset_at`; a
  successful later request returns the run to `in_progress`.
- Progress, requests saved, safe failure classification, and terminal state are
  persisted so page reloads rehydrate the current run.
- Cancellation includes the run's `created_at`, stops only that exact worker,
  and retains a `cancelled` record instead of deleting its lifecycle evidence.
- Successful completion invalidates/refetches the current result and history
  queries. Failures retain a stable client-safe code/message while detailed
  internal diagnostics stay in server logs.
- Interrupted process-local workers are marked `cancelled` when their
  cancellation can be persisted safely. A later explicit start remains
  retryable and cannot collide with an older active row.

---

## Match Fetcher Job

- **Job Type:** `MATCH_FETCHER`
- **Default schedule:** Every 1 hour (`3600` seconds; configurable)
- **Purpose:** Fetch new matches for tracked players across every
  product-supported queue and update Solo/Duo rank snapshots.

### Workflow

```
For each tracked player:
1. sync_matches_for_player()
   ├── For each queue in the canonical product-supported set:
   │   ├── Fetch match IDs from Riot API (batches of 100)
   │   ├── Filter out already-analyzed matches
   │   ├── For each new match:
   │   │   ├── Sleep 1.2s (rate limit protection)
   │   │   ├── Fetch full match details
   │   │   ├── Fetch match timeline
   │   │   ├── Skip if outside the current release year (game_version != "16.*")
   │   │   └── Store/update match, participants, and timeline aggregates
   └── Commit changes

2. update_player_league()  # Solo/Duo snapshots only
   ├── Call /lol/league/v4/entries/by-puuid/{puuid}
   ├── Select RANKED_SOLO_5x5 entry only
   ├── Compare with latest record in core.player_leagues
   ├── If different: Create new rank record
   └── Commit changes
```

After a match-source check completes without a recoverable failure,
`core.players.match_synced_at` advances even when Riot returned zero new
matches. After the rank check succeeds, `league_synced_at` advances. Failed,
cancelled, warning-bearing, or rate-limited work does not advance the affected
source timestamp.

### Riot API Calls Made

| Endpoint                                         | Parameters                                                      | Purpose                                              |
| ------------------------------------------------ | --------------------------------------------------------------- | ---------------------------------------------------- |
| `GET /lol/match/v5/matches/by-puuid/{puuid}/ids` | `start=0, count=100, queue in [420, 440, 480, 400, 450, 2400]` | Get queue-specific match IDs                         |
| `GET /lol/match/v5/matches/{matchId}`            | -                                                               | Get full match details                               |
| `GET /lol/match/v5/matches/{matchId}/timeline`   | -                                                               | Get timeline events for objective aggregates         |
| `GET /lol/league/v4/entries/by-puuid/{puuid}`    | -                                                               | Get current ranked entries (Solo used for snapshots) |

### Rate Limiting Strategy

- **Strict throttling**: 1.2 second delay between match detail requests
- **Cross-component coordination**: `DBRateLimiter` uses
  `RateLimitComponent.MATCH_FETCHER`
- The database layer retains conservative global quotas and component
  priorities; each Riot client additionally adapts to response-reported
  application and method windows per routing/service scope.
- Rate limit errors (`429`) trigger `RateLimitSignal`, causing graceful job termination with `RATE_LIMITED` status. New-player background Match Fetcher executions use the same status and retain the safe `retry_after` value in their execution details.

### Error Handling

| Error Type                               | Behavior                                                      |
| ---------------------------------------- | ------------------------------------------------------------- |
| `RateLimitError`                         | Stop cleanly with `RATE_LIMITED`                              |
| `AuthenticationError` / `ForbiddenError` | Stop with `FAILED` and `has_api_key_error=true`               |
| Match, timeline, or rank response error  | Record a warning, skip the affected unit, and continue        |
| Player processing error                  | Roll back that player, record a warning, and continue         |
| Database or execution-wide error         | Roll back and stop with `FAILED`                              |
| Riot-writer maintenance                  | Stop cleanly with `CANCELLED`                                 |

For each recoverable Match Fetcher failure, the admin execution record stores a
bounded, secret-safe diagnostic with the failed operation, exception type, safe
HTTP status where available, and relevant queue, match, or player identifiers.
The final status remains `SUCCESS`, while `completed_with_warnings`,
`warning_count`, and `warning_summary` in `execution_log` make partial work
visible without populating the failure-only `error_message` field.

### Database Tables Updated

- **core.matches**: Match metadata (timestamps, duration, queue, etc.)
- **core.match_participants**: Full participant data including stats, items, runes
- **core.match_timelines**: Objective timeline aggregates per participant
- **core.players**: Minimal participant records for missing players
- **core.player_leagues**: New Solo/Duo snapshot if rank has changed

### Season Filtering

The job only processes matches from the current 2026 release year. Riot game
versions use the `16.*` prefix, so the job stops fetching when it encounters an
older match. This boundary is intentionally explicit so a new release year
requires a reviewed update rather than silently mixing historical data.

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
    "interval_seconds": 3600
  },
  "is_active": true
}
```

Queue meanings:

- `420` = Ranked Solo/Duo
- `440` = Ranked Flex
- `480` = Swiftplay
- `400` = Normal Draft
- `450` = ARAM
- `2400` = ARAM: Mayhem

These six IDs come from the central product allowlist shared by the Riot client
and Match Fetcher. The larger `QueueType` reference catalog does not
automatically enable new or rotating modes. A newly reviewed product-supported
queue is included automatically when it is added to that allowlist.

`enabled_queue_ids` is an obsolete historical `config_json` field. Runtime
execution ignores it, API responses omit it, and ordinary Match Fetcher
configuration updates remove it. The Jobs UI no longer exposes per-queue
checkboxes. `is_active`, schedule, Trigger Now, tests, pause/stop, and History
remain independent job-level controls.

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
| Ranked entry omits `leagueId`             | Current by-PUUID response shape   | Expected; persist the rank snapshot with a null ID |
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

Every successful two-source profile check advances
`core.players.profile_synced_at`, including a check that finds no changed
identity fields. Failed, cancelled, or rate-limited checks do not advance it.

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

### Error Handling

The Player Updater fetches both Riot responses before mutating a player, then
commits that player atomically. An isolated provider or validation problem is
rolled back, recorded as a bounded warning, and processing continues with the
next player; the regular run finishes `SUCCESS` with warning details. Riot key
rejection finishes `FAILED`, local or upstream rate exhaustion finishes
`RATE_LIMITED`, maintenance finishes `CANCELLED`, and database or
execution-wide failures remain `FAILED`.

---

## API Key Handling

The system retrieves the Riot API key with database priority:

1. Select the newest active, non-expired key in `core.riot_api_keys`
2. Fall back to `RIOT_API_KEY` from `.env` when no valid database key exists

**When the API key is missing or invalid:**

- Key lookup finds no usable credential, or a Riot call returns `401
  Unauthorized` / `403 Forbidden`
- Job raises `AuthenticationError`
- Job terminates with `FAILED` status
- `jobs.job_executions.has_api_key_error` is stored as `true` for the failed run
- Error logged: "Authentication failure during {operation}"
- The tracked Riot client also records current-generation rejection in
  `core.riot_credential_health`; both role-specific header presentations read
  that shared state through `/api/v1/settings/service-status`

Job history remains diagnostic and does not decide current credential health.
A new credential generation immediately invalidates an old run's failure;
`429`, upstream failures, and network errors do not mark a credential invalid.

**Resolution:** Update the key in Settings, or update `RIOT_API_KEY` and its
non-secret `RIOT_API_KEY_VERSION` together and restart the backend.
