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

> Analyzes matchmaking fairness by comparing the average win rates and average
> ranks of a player's allies vs enemies across their last N ranked matches.

## Product Question and Fairness Threshold

The analysis answers **"Is matchmaking fair for this player?"** by computing:

- **Average Ally Team Win Rate** — the average of per-match ally-team win
  rates across the analyzed matches
- **Average Enemy Team Win Rate** — the same for the opposing teams
- **Average Ally / Enemy Rank** — per-side means over the unique players'
  LP-equivalent rank values, with per-tier distribution buckets
- **Per-match Solo/Duo classification** — so the client can split the
  aggregate by scope (All / SoloQ / DuoQ)

If the win-rate numbers are close, matchmaking is fair. The product threshold
is a **3-percentage-point gap** (`winrateDiff >= 0.03` favorable,
`<= -0.03` unfavorable, otherwise "relatively fair").

### Run parameters

A run is parameterized (persisted in `matchmaking_analyses.params`, echoed on
every read; `NULL` = legacy = `{match_count: 10, end_date: null}`):

- **`match_count`** — spine size, 5–30 (UI presets 10/20/30, default 10).
- **`end_date`** — optional UTC day; the spine becomes the last N matches
  played **on or before that day** (match-v5 `endTime` = exclusive next
  midnight UTC). This is what makes "run it for games a month back and compare
  against today" possible.

The resumed worker re-reads params from the run row — a restarted process has
no request payload.

---

## The Analysis Contract (Intentional Product Algorithm)

This algorithm is a deliberate product decision, not an implementation detail.
Changing any element below is a product change.

### Spine and anchors

1. Fetch the current player's **last N ranked Solo/Duo (queue 420) match
   IDs** (`endTime` only when the run has an `end_date`). This is always 1
   API call that cannot be skipped. These N matches are the **spine**; all
   subsequent work is relative to them. **Floor: 5 found matches** — a
   backdated window that yields fewer than requested but at least 5 still
   completes (failing it would break the month-back use case); below 5 the
   run fails `not_enough_matches`.
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
3. Final: mean of the N per-match ally averages and of the N per-match enemy
   averages → `{ team_avg_winrate, enemy_avg_winrate }`. The per-match pairs
   are also persisted (`per_match`, both-sided matches only) so the client can
   recompute the aggregate for a SoloQ- or DuoQ-only scope; the "All" scope
   always displays the stored aggregate, never a client recomputation.

### Participant ranks (nearest-snapshot rule)

Each unique participant gets one Solo/Duo rank per run, resolved
snapshot-first against `core.player_leagues`:

1. The stored snapshot **nearest the run's reference time** (now for latest
   runs, the chosen day for backdated runs) is reused without an API call
   when it falls inside the freshness window — 24 h for latest runs, ±14 days
   around `end_date` for backdated runs.
2. Otherwise one league-v4 call fetches the current entry, and — for
   **non-tracked players only** — persists it as a new snapshot, so backdated
   runs get progressively more period-accurate as the tool is used. Tracked
   players are never written here: Match Fetcher owns their snapshot cadence,
   and an analysis-time snapshot inside its before/after observation window
   would downgrade LP attribution to `counter_mismatch` (`match_lp.py`).
3. A failed or empty league read degrades the player to **UNRANKED** (never
   fails the run); UNRANKED players are excluded from the averages and
   counted in their own tier bucket.

Ranks are mapped to one LP-equivalent scalar
(`tier_index × 400 + division × 100 + LP`; MASTER+ = `2800 + LP`) in
`ranks.py`; the frontend formatter mirrors the scale and shared test fixtures
guard drift. `rank_freshness` records how many ranks were period-accurate vs
current-day so the UI can caption backdated runs honestly — historical rank
data starts as "today's ranks" and improves with use. A live read is judged
against the same window its stored snapshot will be judged by, so an identical
rerun reports the same split instead of flipping current-day to period-accurate.

### Duo classification (heuristic)

A spine match is classified **DuoQ** when any non-analyzed player appears on
the analyzed player's team in ≥ 2 spine matches (`classify_duo_matches`,
pure, zero API calls — computed from stored participants). Riot's match-v5
carries no party data, so this is a deliberate co-occurrence heuristic; false
positives are possible at small windows, and `per_match` retains the flags so
the rule can be tightened later without refetching.

### Call and count accounting

With N spine matches (formulas in `theoretical_max_requests`):

- `players_analyzed` = **9N + 1** unique-slot maximum (current player + 9
  others per spine match).
- `matches_analyzed` = N + 9N × 10: the basis size shown in the UI; every
  player's win-rate model uses ≤10 matches.
- The internal additional-match-detail workload is N spine details +
  9N participants × 9 non-spine details — one of each participant's 10
  matches is the already-known spine match.
- One league-v4 call per unique player: **9N + 1**.
- Theoretical maximum without any DB cache: `(1 + 9N) + N + 81N + (9N + 1)`
  — **1,002** at N=10, ~3,000 at N=30. `requests_saved` is this maximum minus
  actual API calls made.

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

A fully warm cache (matches **and** fresh rank snapshots) therefore completes
a run with 1 API call (the spine list). Rank snapshots warm separately from
matches: the first run after the extension pays up to 9N+1 league calls even
over a warm match cache.

---

## Lifecycle Invariants

### Run ownership

Every run belongs to the account that started it (`user_id`, NOT NULL, revision
`20260822_0030`), and every query -- read, attach, cancel, delete -- is scoped
to it. Before that, a run was identified by `(puuid, created_at)` alone, and
`created_at` is returned by the status and history endpoints: reflecting one
field back was enough for any signed-in account to cancel another's running
analysis or permanently delete their completed record.

The scope is not applied per endpoint. `MatchmakingAnalysisService` takes the
owner in its constructor, resolved once in `dependencies.py` from
`CurrentUserDep`, so an endpoint cannot be written that forgets it. The
background worker constructs its own service with the same owner rather than
inheriting an ambient one.

### DB-first start

`POST /matchmaking-analysis/start` returns the **persisted active run before
any Riot preflight**. `start_analysis` attaches to an existing active row when
one exists; otherwise it inserts a `pending` row and relies on the partial
unique index `uq_matchmaking_analyses_active_puuid` (at most one `pending`,
`in_progress`, or `waiting_rate_limit` row per `(user_id, puuid)`) to resolve
concurrent starts — the loser of the race attaches to the winner's row. Both
the attach and the index are scoped to the calling account, so the race being
resolved is between one account's own concurrent starts; another account
analyzing the same player gets its own run. The start
response carries the exact run identity `(puuid, created_at)`; the frontend
seeds its state from it and polls that exact identity.

The minimum-match Riot preflight happens inside the background run, so the
start request stays bounded; an insufficient history becomes a retryable
`failed` run (`not_enough_matches`), not a start error.

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

Cancellation targets the exact `(puuid, created_at)` run **belonging to the
calling account**, persists a terminal `cancelled` record (retained for
diagnostics), then stops that worker. A run the caller does not own is not
found rather than refused, so the response says nothing about whether somebody
else is analyzing that player. Matches fetched so far stay persisted; a new
start remains retryable.

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

Rate limiting is entirely reactive. The Riot client waits out the windows
it reads from Riot's rate-limit response headers; a 429 that still lands waits
`Retry-After` and retries up to 10 times per call before the run fails with a
rate-limit error code. The analysis no longer yields to Player Updater or
Match Fetcher — the limiter that arranged that was deleted with its table (see
[riot-api.md](riot-api.md)).

While waiting, the run stays active as `waiting_rate_limit` with
`rate_limit_reset_at` set by the 429 wait helper; a later successful provider
request returns it to `in_progress` and clears the timestamp.

**Clock caveat:** `rate_limit_reset_at` is one window's reset, not the run's,
so it must **never be presented as an analysis completion clock**. The UI shows one continuous
whole-run ETA that interpolates between backend-authoritative player
milestones (using the 100-request/120-second long window and a representative
warm-cache workload) and caps the projection at 99%; only authoritative
completion reaches 100% and triggers result/history refresh.

---

## Frontend Contract Essentials

- The global current player is the **reference player** and seeds the page only
  when no local target has been chosen. The **analyzed player** is local to
  Matchmaking Analysis and is encoded in that route's PUUID; selecting or
  discovering it never changes global current-player context and never tracks
  it. The action, latest result, active run, and history are all keyed by that
  analyzed PUUID so changing targets cannot relabel another player's run.
- Matchmaking Analysis and the sidebar reuse the same one-field player selector:
  stored suggestions include their server, while a new `Name#Tag` asks for a
  server only before the non-tracking discovery request.
- The component polls the exact `created_at` run every 3 seconds, rehydrates an
  active run on reload, and keeps the `X / N×10` count backend-authoritative
  (the fallback expectation before progress keys exist is
  `params.match_count × 10`).
- **DB-only fast flow** detection: a run that completes without ever being
  observed `in_progress`/`waiting_rate_limit`, or with backend progress still
  < 10, plays the artificial fast animation
  (`!state.sawInProgress || state.lastBackendProgress < 10` in
  `matchmaking-analysis-session.tsx`, state in
  `matchmaking-analysis-state.ts`). There is no status-string check
  against a previous `pending` value.
- `failed` runs stay visibly retryable; provider rate-limit terminology is not
  exposed.

---

## Edge Cases

| Scenario                                      | Handling                                                        |
| --------------------------------------------- | --------------------------------------------------------------- |
| Player has <5 ranked matches in the window    | Fast start succeeds; background run becomes retryable `failed`  |
| 5 ≤ found < requested (sparse backdated window) | Run completes over the found matches; `matches_requested` records the ask and `spine_matches_found` the reality, so the card can caption "8 of 30" |
| League read fails/empty for a participant     | Player counted UNRANKED; excluded from rank averages            |
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
