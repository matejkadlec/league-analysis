# Matchmaking Analysis

> **Authority:** Matchmaking analysis algorithm, lifecycle invariants,
> persistence contract, and credential/rate-limit failure behavior.
>
> **Maintenance:** Update when the product algorithm (spine size, anchoring,
> caching, averaging, call accounting), a lifecycle or persistence invariant, a
> failure-classification rule, or an operational caveat recorded here changes.
> Route signatures, schemas, and component internals live in
> `backend/app/features/matchmaking_analysis/` and
> `frontend/features/matchmaking/` and are not mirrored here.

> Analyzes matchmaking fairness by comparing the average win rates of a
> player's allies vs enemies across their last 10 ranked matches.

## Product Question and Fairness Threshold

The analysis answers **"Is matchmaking fair for this player?"** by computing:

- **Average Ally Team Win Rate** — the average of per-match ally-team win
  rates across 10 matches
- **Average Enemy Team Win Rate** — the same for the opposing teams

If both numbers are close, matchmaking is fair. The product threshold is a
**3-percentage-point gap** (`winrateDiff >= 0.03` favorable,
`<= -0.03` unfavorable, otherwise "relatively fair").

---

## The Analysis Contract (Intentional Product Algorithm)

This algorithm is a deliberate product decision, not an implementation detail.
Changing any element below is a product change.

### Spine and anchors

1. Fetch the current player's **last 10 ranked Solo/Duo (queue 420) match
   IDs** with no `endTime` — the actual latest matches. This is always 1 API
   call that cannot be skipped. These 10 matches are the **spine**; all
   subsequent work is relative to them.
2. **Each spine match has its own anchor timestamp** — that match's effective
   `game_start_timestamp` (its `game_start_timestamp_source` distinguishes an
   actual Riot start from a preserved legacy creation-time fallback). A spine
   match whose timestamp cannot be resolved is skipped.
3. A participant's win rate is their record over their **last 10 ranked
   matches at the anchor time** (`endTime = anchor_ms // 1000 + 1`), so it
   reflects their strength when they played with the current player, not
   today. Fewer than 10 available matches at the anchor is tolerated: all
   available matches are used.

### Win-rate caching rule

Participant win rates are **cached by PUUID** (`_winrate_cache`). A player who
appears in several spine matches has their win rate computed **once**, at the
anchor of the first spine match in which they are encountered (spine matches
are processed most-recent first), and that value is reused for their later
appearances. Win rates are **not** recomputed per spine match.

### Averaging

Average of averages of averages:

1. Per player: wins / matches over their ≤10 anchored matches.
2. Per spine match: mean of the 5 ally win rates and mean of the 5 enemy win
   rates (the current player counts on the ally side of every spine match).
3. Final: mean of the 10 per-match ally averages and of the 10 per-match enemy
   averages → `{ team_avg_winrate, enemy_avg_winrate }`.

### Call and count accounting

With 10 spine matches:

- `players_analyzed` = **91** (current player + 9 others per spine match).
- `matches_analyzed` = **910** (10 + 90 × 10): the basis size shown in the UI;
  every player's win-rate model uses 10 matches.
- The internal additional-match-detail workload is **820** (10 spine details +
  90 participants × 9 non-spine details — one of each participant's 10 matches
  is the already-known spine match).
- Theoretical maximum without any DB cache: **911** calls
  (1 + 90 match-list calls, plus 820 match-detail calls). `requests_saved` is
  this maximum minus actual API calls made.

---

## DB-First Data Access

The analysis checks the database before every Riot call:

- **Match lookup**: use any `core.matches` row if present; otherwise fetch from
  the API and **persist the match** for future runs.
- **Win-rate shortcut**: if `core.match_participants` joined with
  `core.matches` yields ≥10 rows for the player with `queue_id = 420`,
  `game_start_timestamp <= anchor`, `fully_analyzed = true`, the win rate is
  computed entirely from the DB — saving up to **10 API calls** for that player
  (1 match-list call + 9 additional match details, per the accounting above).
- With <10 DB rows, the match-ID list comes from the API and each match is
  still checked in the DB before a detail fetch.

A fully warm cache therefore completes a run with 1 API call (the spine list),
saving up to 910 of the theoretical 911.

---

## Lifecycle Invariants

### DB-first start

`POST /matchmaking-analysis/start` returns the **persisted active run before
any Riot preflight**. `start_analysis` attaches to an existing active row when
one exists; otherwise it inserts a `pending` row and relies on the partial
unique index `uq_matchmaking_analyses_active_puuid` (at most one `pending`,
`in_progress`, or `waiting_rate_limit` row per PUUID) to resolve concurrent
starts — the loser of the race attaches to the winner's row. The start
response carries the exact run identity `(puuid, created_at)`; the frontend
seeds its state from it and polls that exact identity.

The minimum-match Riot preflight happens inside the background run, so the
start request stays bounded; an insufficient history becomes a retryable
`failed` run (`not_enough_matches`), not a start error. The optional
`check-matches` route is diagnostic only.

### Restart-resume (deliberate, and deliberately not startup recovery)

If the server restarts mid-run, the analysis row remains active with
`completed_at = NULL`. Shutdown can cancel the worker **before**
`_run_analysis` sets `started_at`, so a resumable row may still be `pending`
with `started_at = NULL` — treat that state as resumable, not stranded. On the
next explicit start, `start_analysis` attaches to the row, relaunches its
worker, and preserves already-completed `puuid_progress` keys
(`started_at` is set with `coalesce`, so the original start survives).

Startup recovery (`_cancel_orphaned_player_syncs` in the jobs scheduler)
**deliberately excludes** `core.matchmaking_analyses`: this table has the
opposite contract from `jobs.player_sync_runs`, and cancelling active rows at
boot would discard resumable progress.

### Progress format

`puuid_progress` (JSONB) maps `"{puuid}:{match_id}"` keys to booleans — one
key per participant slot per spine match, pre-populated after the spine is
known and flipped true per player as win rates complete. The model column
comment (`{puuid: true/false}`) is stale; this composite-key description is
authoritative. Progress counts shown to the client are
`sum(values) / len(keys)`.

### Cancellation

Cancellation targets the exact `(puuid, created_at)` run, persists a terminal
`cancelled` record (retained for diagnostics), then stops that worker. Matches
fetched so far stay persisted; a new start remains retryable.

---

## Failure Classification

Failures persist a stable client-safe `error_code`/`error_message`; raw
provider or internal text is never returned to the browser. The rate limiter is
released and the in-process task deregistered on any crash.

**Credential failures are never optional data.** Any `AuthenticationError` or
`ForbiddenError` re-raises even on optional cache-filling fetches
(service.py `_api_fetch_match_ids` / `_api_fetch_match`: auth errors bypass
the `required` check) and terminates the run with
`error_code=RIOT_API_KEY_INVALID`. A `404` may be skipped **only** on optional
fetches; required fetches propagate it.

Because analysis status travels inside successful HTTP-200 polling bodies, the
original Riot 401/403 can never reach the browser as an HTTP status. The
frontend must read the persisted `error_code`; the shared Axios interceptor
recognizes `RIOT_API_KEY_INVALID` in lifecycle payloads and refreshes the
backend-owned credential-health state. Accepting, polling, or completing an
analysis never marks the key valid — only a direct Riot response is credential
evidence (see [riot-api.md](riot-api.md)).

---

## Rate Limiting

The analysis uses `DBRateLimiter` with **priority 3 (lowest)** and a **30
minute max wait**, yielding to Player Updater (1) and Match Fetcher (2). Every
call goes through `acquire()`/`record_request()`; a Riot 429 waits
`Retry-After` and retries up to 10 times per call before the run fails with a
rate-limit error code.

While waiting, the run stays active as `waiting_rate_limit` with
`rate_limit_reset_at` set (via the acquire wait callback or the 429 wait
helper); a later successful provider request returns it to `in_progress` and
clears the timestamp.

**Clock caveat:** the DB-limiter window reset can precede the adaptive
per-client limiter's remaining wait, so `rate_limit_reset_at` must **never be
presented as an analysis completion clock**. The UI shows one continuous
whole-run ETA that interpolates between backend-authoritative player
milestones (using the 100-request/120-second long window and a representative
warm-cache workload) and caps the projection at 99%; only authoritative
completion reaches 100% and triggers result/history refresh.

---

## Frontend Contract Essentials

- The component polls the exact `created_at` run every 3 seconds, rehydrates an
  active run on reload, and keeps the `X / 100` count backend-authoritative.
- **DB-only fast flow** detection: a run that completes without ever being
  observed `in_progress`/`waiting_rate_limit`, or with backend progress still
  < 10, plays the artificial fast animation
  (`const isFast = !sawInProgressRef.current || lastBackendProgressRef.current < 10`,
  `matchmaking-analysis.tsx` ~lines 288–289). There is no status-string check
  against a previous `pending` value.
- `failed` runs stay visibly retryable; provider rate-limit terminology is not
  exposed.

---

## Edge Cases

| Scenario                                      | Handling                                                        |
| --------------------------------------------- | --------------------------------------------------------------- |
| Player has <10 ranked matches                 | Fast start succeeds; background run becomes retryable `failed`  |
| Player not found in first spine match         | `failed` with safe classification (`player_not_in_match`)       |
| Riot 429                                      | Wait internally with continuous total ETA; retry up to 10 times |
| Riot 401/403 during **any** provider call     | Run terminates with `RIOT_API_KEY_INVALID`; global warning header appears |
| Riot 404 on an **optional** fetch             | That match/player is skipped; available data is used            |
| Riot 404/failure on a **required** fetch      | Error propagates; run becomes `failed`                          |
| DB connection error                           | Exception propagates; run marked `failed`                       |
| Browser reload during analysis                | Exact persisted run rehydrated; polling continues               |
| Server restart during analysis                | Active record remains; next explicit start resumes it           |
| Same player in multiple spine matches         | Win rate computed once at first-encounter anchor, cached by PUUID |
| Analysis already running for player           | Unique active row is returned; no duplicate task is created     |
| Exact run cancelled                           | Terminal `cancelled` record retained; fetched matches kept      |
| Background task crash                         | Marked `failed` safely; rate limiter released                   |
