# Background Jobs Documentation

This document describes the automated background jobs in the League Analysis system.

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

1. **Marks stale jobs as failed** - Any jobs stuck in `RUNNING` state (from ungraceful shutdowns) are marked as `FAILED`
2. **Detects overdue jobs** - Checks if any active jobs haven't run within their configured interval
3. **Runs overdue jobs immediately** - Executes all overdue jobs in parallel to catch up
4. **Schedules regular execution** - Sets up future job triggers based on configured intervals

This ensures the system automatically recovers from downtime without manual intervention.

---

## Match Fetcher Job

**Job Type:** `MATCH_FETCHER`  
**Schedule:** Every 15 minutes (configurable)  
**Purpose:** Fetch new matches for tracked players (configurable queues) and update Solo/Duo rank snapshots.

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
  "schedule": "every 15 minutes",
  "config_json": {
    "interval_seconds": 900,
    "enabled_queue_ids": [420, 440, 400, 450]
  },
  "enabled": true
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
| Job stuck in RUNNING                     | Crash during execution           | Check logs, manually set to FAILED                |
| No matches fetched                       | All matches already analyzed     | Expected behavior if no new games                 |

---

## Player Updater Job

**Job Type:** `PLAYER_UPDATER`  
**Schedule:** Every 24 hours (configurable)  
**Purpose:** Update player profile information (name, tag, icon, summoner level).

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
  "schedule": "every 24 hours",
  "config_json": {
    "interval_seconds": 86400
  },
  "enabled": true
}
```

### Metrics Tracked

- `records_updated`: Number of player profiles updated
- `api_requests_made`: Total Riot API calls (2 per player)

---

## API Key Handling

The system retrieves the Riot API key with database priority:

1. Check `jobs.settings` table for `riot_api_key`
2. Fall back to `RIOT_API_KEY` environment variable

**When API Key is Invalid:**

- First API call returns `401 Unauthorized` or `403 Forbidden`
- Job raises `AuthenticationError`
- Job terminates with `FAILED` status
- `jobs.job_executions.has_api_key_error` is stored as `true` for the failed run
- Error logged: "Authentication failure during {operation}"
- Frontend header warning (red banner) is triggered when latest execution in
  `/jobs/status/overview` is `FAILED` with `has_api_key_error=true`

**Resolution:** Update API key in Settings page or `.env` file
