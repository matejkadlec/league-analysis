# Matchmaking Analysis

> Analyzes matchmaking fairness by comparing the average win rates of a player's allies vs enemies across their last 10 ranked matches.

## Overview

The matchmaking analysis answers the question: **"Is matchmaking fair for this player?"** by computing:

- **Average Ally Team Win Rate** — the average of per-match team win rates across 10 matches
- **Average Enemy Team Win Rate** — the same for the opposing teams

If both numbers are close (~50%), matchmaking is fair. A large gap (>=3%) suggests the player is consistently placed with stronger/weaker teammates or opponents.

### Key Concept: Per-Match Anchors

Each player's win rate is calculated from their **last 10 ranked matches at the time of the specific match they played with the current player**, not their current overall win rate. Each spine match has its own **anchor timestamp** — that match's `game_start_timestamp`.

This means:

- Match 1's participants → anchored to Match 1's timestamp
- Match 2's participants → anchored to Match 2's timestamp
- etc.

**Note**: If a player appears in multiple spine matches, their winrate is cached from the first encounter (most recent match) for efficiency.

---

## Architecture

### Components

| Component          | Technology           | Responsibility                                  |
| ------------------ | -------------------- | ----------------------------------------------- |
| Backend Service    | Python/FastAPI       | Analysis logic, DB queries, Riot API calls      |
| Background Task    | `asyncio.Task`       | Runs analysis independently of HTTP request     |
| DB Rate Limiter    | PostgreSQL           | Coordinates API usage with other components     |
| Frontend Component | React/TanStack Query | Polling, progress display, rate limit countdown |

### Data Flow

```
User clicks "Start Analysis"
    │
    ▼
POST /matchmaking-analysis/start
    │
    ├── Creates DB record (status: pending)
    ├── Spawns asyncio background task
    └── Returns immediately with analysis ID
         │
         ▼
    Background Task runs independently
         │
         ├── Step 1: Fetch current player's last 10 match IDs (no endTime)
         ├── Step 2: For each match (per-match processing):
         │       a. Use THIS match's timestamp as anchor
         │       b. Calculate all 10 participants' winrates with this anchor
         │       c. Average team vs enemy for this match
         ├── Step 3: Average the 10 per-match results
         └── Saves results to DB
              │
              ▼
    Frontend polls GET /status every 3 seconds
         │
         ├── Shows progress bar (X/100 players)
         ├── Shows rate limit countdown when waiting
         └── Shows results when completed
```

---

## Calculation Logic

### Step-by-Step

#### 1. Get Current Player's Last 10 Matches (Spine Matches)

```
API call: GET /lol/match/v5/matches/by-puuid/{puuid}/ids
    ?queue=420
    &count=10
```

No `endTime` — we want the actual latest 10 ranked matches for the current player. This is always 1 API call that cannot be skipped.

These 10 matches are the "spine" of the analysis. All subsequent calculations are relative to these matches.

#### 2. Per-Match Processing with Per-Match Anchors

**Key Concept: Each spine match has its own anchor timestamp!**

For each of the 10 spine matches:

```
anchor = game_start_timestamp of THIS spine match (not just the first one)

For each of the 10 participants in this match:
    API call: GET /lol/match/v5/matches/by-puuid/{puuid}/ids
        ?queue=420
        &count=10
        &endTime={anchor / 1000 + 1}

    For each returned match ID:
        Get win/loss from DB or API → calculate wins / total

Calculate average team winrate and average enemy winrate for THIS match
```

This ensures each player's winrate is calculated relative to the time they played with the current player in THAT specific match, not relative to some global timestamp.

#### 3. Collect All Participants

For each of the 10 spine matches, get all 10 participants (puuid + team_id). This yields up to 100 participant slots, but typically ~91 unique players since the current player appears in all 10 matches and there's some overlap between matches.

#### 4. Calculate Win Rates

For **each unique player**:

```
For each spine match this player appears in:
    anchor = that match's game_start_timestamp

    API call: GET /lol/match/v5/matches/by-puuid/{puuid}/ids
        ?queue=420
        &count=10
        &endTime={anchor / 1000 + 1}

    For each returned match ID:
        Get win/loss from DB or API → calculate wins / total
```

Note: `endTime` is used here because we want each player's win rate **at the time of each match they played in**, not their current win rate. A player appearing in multiple spine matches will have their winrate calculated multiple times (once per match, with different anchors).

#### 5. Per-Match Team Averages

For each spine match:

```
Match 1:
    Ally Team:    [51.4%, 49.9%, 51.7%, 48.8%, 36.0%]  → avg = 47.56%
    Enemy Team:   [50.5%, 49.7%, 51.2%, 49.8%, 52.4%]  → avg = 50.72%

Match 2:
    Ally Team:    [51.7%, 42.0%, 55.3%, 50.1%, 48.9%]  → avg = 49.60%
    Enemy Team:   [47.2%, 51.8%, 49.0%, 53.1%, 50.9%]  → avg = 50.40%

... (8 more matches)
```

Note: The current player's win rate (51.7% in this example) appears in the ally team of every match.

#### 6. Final Averages

```
Average Ally Team WR   = mean([47.56%, 49.60%, ...])  → e.g., 49.2%
Average Enemy Team WR  = mean([50.72%, 50.40%, ...])  → e.g., 50.1%
```

**This is the final result** — average of averages of averages:

1. Average player win rate (from their 10 matches)
2. Average team win rate (from 5 players per team per match)
3. Average across 10 matches

### Flowchart

```
┌─────────────────────────────────────────────────────┐
│              MATCHMAKING ANALYSIS                    │
│                                                      │
│  Current Player: "PlayerA"                           │
│  Anchor: game_start_timestamp of latest match         │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────┐
│  Step 1: Get PlayerA's last 10 ranked match IDs      │
│          (no endTime — actual latest matches)          │
│                                                      │
│  [Match1, Match2, Match3, ... Match10]               │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────┐
│  Step 2: FOR EACH spine match (per-match anchors)    │
│                                                      │
│  Example: Processing Match1                          │
│    anchor1 = Match1's game_start_timestamp           │
│                                                      │
│  Get 10 participants in Match1                       │
│                                                      │
│  For each participant, calculate their winrate       │
│  using anchor1 (their last 10 matches before Match1) │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────┐
│  Step 3: For each spine match (1 through 10)         │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │  Match N:                                      │  │
│  │                                                │  │
│  │  Ally Team:                                    │  │
│  │    PlayerA  → 60% (cached)                     │  │
│  │    Ally1    → calc from their last 10 matches  │  │
│  │    Ally2    → calc from their last 10 matches  │  │
│  │    Ally3    → calc from their last 10 matches  │  │
│  │    Ally4    → calc from their last 10 matches  │  │
│  │                                                │  │
│  │  Enemy Team:                                   │  │
│  │    Enemy1   → calc from their last 10 matches  │  │
│  │    Enemy2   → calc from their last 10 matches  │  │
│  │    Enemy3   → calc from their last 10 matches  │  │
│  │    Enemy4   → calc from their last 10 matches  │  │
│  │    Enemy5   → calc from their last 10 matches  │  │
│  │                                                │  │
│  │  Ally Avg  = mean(5 ally win rates)            │  │
│  │  Enemy Avg = mean(5 enemy win rates)           │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  Repeat for all 10 matches                           │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────┐
│  Step 4: Final Result                                │
│                                                      │
│  Avg Ally Team WR  = mean(10 per-match ally avgs)    │
│  Avg Enemy Team WR = mean(10 per-match enemy avgs)   │
│                                                      │
│  Result: { team_avg_winrate, enemy_avg_winrate }     │
│                                                      │
│  Interpretation:                                     │
│    Gap < ±3%  → Fair matchmaking                     │
│    Gap >= +3%  → Allies stronger (favorable)          │
│    Gap <= -3%  → Enemies stronger (unfavorable)       │
└──────────────────────────────────────────────────────┘
```

---

## DB-First Strategy

The analysis minimizes API calls by checking the database before calling Riot API:

### Match Lookup Priority

1. **Check DB** — If `core.matches` has the match (any match, not just `fully_analyzed`), use it
2. **Fetch from API** — If not in DB, call Riot API and **store the match in DB** for future use

### Win Rate DB Shortcut

When calculating a player's win rate:

1. **Check DB** — Query `core.match_participants` joined with `core.matches` where:
   - `puuid = player_puuid`
   - `queue_id = 420`
   - `game_start_timestamp <= anchor_timestamp`
   - `fully_analyzed = true`
   - Order by `game_start_timestamp DESC`, limit 10
2. If **≥10 matches found in DB** → skip API entirely (saves 11 API calls: 1 match list + 10 match details)
3. If **<10 matches** → fall back to API to get match IDs, then check DB for each match before fetching

### Savings Example

For a player who has been analyzed before and whose matches are in DB:

| Scenario                                        | Without DB | With DB | Savings |
| ----------------------------------------------- | ---------- | ------- | ------- |
| Spine match IDs (always needed)                 | 1 call     | 1 call  | 0       |
| Spine match details (10 matches)                | 10 calls   | 0 calls | 10      |
| Other players' match IDs                        | 90 calls   | 0 calls | 90      |
| Other players' additional match details         | 810 calls  | 0 calls | 810     |
| **Total (91 expected players)**                 | **911**    | **1**   | **910** |

Formula: `theoretical_max = 1 + 10 + 90 + 810`

Explanation:
- The winrate model still uses 10 matches per player.
- For each non-current participant, one of those 10 is the already-known spine match, so only 9 additional match details are needed.
- This keeps the theoretical maximum at 911 calls and the all-DB maximum saved calls at 910.

---

## Rate Limiting

### Riot API Limits (Development Key)

| Limit     | Window           | Requests |
| --------- | ---------------- | -------- |
| Burst     | 1 second         | 20       |
| Sustained | 2 minutes (120s) | 100      |

### DB Rate Limiter

The analysis uses `DBRateLimiter` with **priority 3 (lowest)** to coordinate with other components:

| Component                | Priority       | Max Wait       |
| ------------------------ | -------------- | -------------- |
| Player Updater           | 1 (highest)    | 30 seconds     |
| Match Fetcher            | 2              | 2 minutes      |
| **Matchmaking Analysis** | **3 (lowest)** | **30 minutes** |

**Behavior:**

- Before each API call, calls `rate_limiter.acquire()` which checks:
  - Is the 2-minute window exhausted? → Wait for window reset
  - Is a higher-priority component active? → Yield (wait 1s and retry)
  - Otherwise → proceed with 50ms minimum spacing between requests
- After each API call, calls `rate_limiter.record_request()` to increment counter

### Rate Limit Countdown (Frontend)

When the analysis hits a rate limit (either via `DBRateLimiter.acquire()` window exhaustion or Riot 429):

1. Backend sets `rate_limit_reset_at` (absolute UTC timestamp) on the analysis DB record via:
   - `acquire_with_wait_callback` → `_rate_limit_wait_callback` (receives `window_end` datetime, sets once at start, clears when done)
   - `_wait_for_rate_limit` (for 429 errors, sets once then sleeps)
2. Frontend polls status every 3 seconds and reads this field
3. Frontend calculates `remainingSeconds = resetTime - Date.now()` and displays countdown
4. When countdown reaches 0 or field becomes null, normal progress display resumes

### 429 Error Handling

When Riot API returns HTTP 429:

1. The `RiotAPIClient` raises `RateLimitError` with `retry_after` seconds
2. The service catches it and calls `_wait_for_rate_limit(retry_after)`
3. This sets the countdown timestamp, sleeps, then clears it
4. The API call is retried (up to 10 retries per call)

---

## Background Processing

### How It Works

When the user clicks "Start Analysis":

1. HTTP POST handler creates a DB record and spawns an `asyncio.Task`
2. The response returns immediately — the user sees "pending" status
3. The background task runs with its **own DB session** and **own RiotAPIClient**
4. Progress is written to DB (`puuid_progress` JSONB column) after each player
5. Frontend polls the status endpoint every 3 seconds to show progress

### Page Close Resilience

The analysis **continues running even if the user closes the browser tab**:

- The `asyncio.Task` lives in the server's event loop, independent of HTTP connections
- When the user returns, the frontend polls the status endpoint and picks up where it left off
- If the server itself restarts, the analysis record remains in DB with `started_at != NULL` and `completed_at = NULL`
- On next request, `start_analysis()` detects this and resumes

### Failure Handling

If the background task crashes:

1. The exception is caught in `_run_analysis_background`
2. The analysis is marked as completed with an error message in `results.error`
3. The rate limiter is released
4. The task is removed from `_running_analyses`

---

## API Endpoints

### POST `/matchmaking-analysis/check-matches`

Check if player has ≥10 ranked matches before starting analysis.

**Request:** `{ "puuid": "..." }`
**Response:** `{ "success": true, "matches_found": 15 }` or `NotEnoughMatchesResponse`

### POST `/matchmaking-analysis/start`

Start a new analysis. Returns immediately with pending status.

**Request:** `{ "puuid": "..." }`
**Response:** `MatchmakingAnalysisResponse`

### GET `/matchmaking-analysis/player/{puuid}`

Get the latest analysis (any status).

**Response:** `MatchmakingAnalysisResponse` (includes `status`, `progress`, `results`, `rate_limit_reset_at`)

### GET `/matchmaking-analysis/player/{puuid}/latest-completed`

Get the latest **completed** analysis (ignores in-progress or errored runs).

**Response:** `MatchmakingAnalysisResponse`

### GET `/matchmaking-analysis/player/{puuid}/status`

Lightweight status poll (used every 3 seconds by frontend).

**Response:** `MatchmakingAnalysisStatusResponse`

### GET `/matchmaking-analysis/player/{puuid}/history`

Get completed analysis history.

**Response:** `{ "items": [{ "created_at", "team_avg_winrate", "enemy_avg_winrate", "gap" }] }`

---

## Frontend Components

### `MatchmakingAnalysis` (main component)

- Shows start button when no analysis is active
- Polls status every 3 seconds when active
- Displays progress bar (X/100 players)
- Shows rate limit countdown when `rate_limit_reset_at` is set (updated via `acquire_with_wait_callback`)
- Shows inline results table when completed
- "Run New Analysis" button to start a fresh analysis
- **Completion animation**: Shows green "Analysis finished successfully" text and toast for 1 second before transitioning to results
- **DB-only fast flow**: When all data is in DB (detected by `prevStatus === "pending"` or `progress < 10`), shows artificial progress animation: 0% → 50% ("Fetching from database...") → 100% ("Finished") → results
- **Smooth transitions**: Card uses `transition-all duration-300` for height changes between states
- **Cancel toast**: Uses yellow warning style (`toast.warning`)

### `MatchmakingResults`

- Separate card showing the latest completed results
- Team vs Enemy win rate comparison
- ±3% fairness assessment color coding

### `MatchmakingHistory`

- Table of past analyses with date, team WR, enemy WR, gap
- Color-coded green/red based on gap direction
- Shows up to 10 rows in view; older records are accessible via vertical scroll

### `MatchmakingExplanation`

- Expandable card with flowchart image

---

## Database Schema

### `core.matchmaking_analyses`

| Column                | Type        | Description                                                                   |
| --------------------- | ----------- | ----------------------------------------------------------------------------- |
| `puuid`               | VARCHAR(78) | Player PUUID (PK part 1)                                                      |
| `created_at`          | TIMESTAMPTZ | Analysis creation time (PK part 2)                                            |
| `started_at`          | TIMESTAMPTZ | When background task started                                                  |
| `completed_at`        | TIMESTAMPTZ | When analysis finished                                                        |
| `results`             | JSONB       | `{ team_avg_winrate, enemy_avg_winrate, matches_analyzed, players_analyzed }` |
| `puuid_progress`      | JSONB       | `{ "puuid:match_id": true/false }` for tracking progress                      |
| `requests_saved`      | INTEGER     | Count of API calls saved by DB cache                                          |
| `rate_limit_reset_at` | TIMESTAMPTZ | When rate limit resets (NULL = not waiting)                                   |

Notes:
- With 10 spine matches, `players_analyzed` is recorded as 91 (current player + 9 others per match).
- `matches_analyzed` is recorded as 910 (10 + 90*10) to represent the basis size shown in the UI.
- The internal additional-match workload remains 820 (10 spine matches + 90 participants * 9 additional non-spine matches).

---

## Edge Cases & Error Handling

| Scenario                                      | Handling                                                       |
| --------------------------------------------- | -------------------------------------------------------------- |
| Player has <10 ranked matches                 | Pre-check endpoint returns error; analysis not started         |
| Player not found in first match               | Analysis completed with error                                  |
| Riot API 429 (rate limited)                   | Wait with countdown, retry up to 10 times                      |
| Riot API 5xx (server error)                   | Retry with exponential backoff (handled by RiotAPIClient)      |
| Riot API 403/404                              | Skip that match/player, use available data                     |
| DB connection error                           | Exception propagates, analysis marked as failed                |
| Server restart during analysis                | Analysis record stays in-progress; resumed on next start       |
| Same player appears in multiple spine matches | Win rate calculated once, cached and reused                    |
| Player has <10 ranked matches at anchor time  | Uses all available matches (even if <10)                       |
| Analysis already running for player           | Returns existing analysis status                               |
| Background task crash                         | Analysis marked as completed with error, rate limiter released |
