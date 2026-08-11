# Riot API Reference

> **Authority:** Riot API routing, endpoints, credential precedence, response
> boundaries, and rate-limit behavior used by League Analysis.
>
> **Maintenance:** Update when Riot routing, endpoints, DTOs, credentials,
> throttling, or feature usage changes.

The dated [2026-08-03 compatibility audit](riot-api-compatibility-2026-08-03.md)
traces every caller and consumer and defines the remediation scope implemented
by LGA-42. Sanitized protected fixtures captured on 2026-08-08 cover the used
Account, Summoner, Match, and Timeline shapes for queues 400, 420, 440, and
450. Transparent synthetic variants derived from those fixtures verify queue
identity and tolerant contract handling for Swiftplay 480 and ARAM: Mayhem
2400 without claiming a new protected-provider capture.

---

## 1. Core Concepts

### Authentication

- **Header**: `X-Riot-Token: RGAPI-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
- **Key Validity**: Development keys expire every **24 hours**
- **Storage**: API key stored in `core.riot_api_keys` table (database priority, env fallback)

### PUUIDs Are Bound to the Developer Account

Riot encrypts every PUUID per developer account. A PUUID obtained under one
account's API key is rejected by every `by-puuid` endpoint when the request
uses a key from a different developer account; the response is
`400 Invalid request parameters`, not `401`, so it is easy to misread as a
malformed request.

Consequences:

- Rotating to a key from a **different** developer account invalidates every
  stored PUUID. Rotating keys within the same account is safe.
- Datasets fetched under different developer accounts cannot be merged as-is;
  the same player appears under two unrelated PUUIDs.
- The recovery path is ACCOUNT-V1 **Get Account by Riot ID** (`game_name` and
  `tag_line` are stored in `core.players`): resolve the player under the
  current key, then remap the stored PUUID and every referencing row
  (`core.players` is referenced by puuid from match, league, analysis, sync,
  and tracking tables).

Plan any future switch of the production key to a different developer account
(for example after Riot application review) as a data migration, not a
configuration change.

#### How the code detects and repairs the condition

- The client inspects Riot's `status.message` on a 400 and raises
  `PuuidDecryptionError` (a `BadRequestError` subclass) when it reports a
  decryption failure. The condition travels as an exception type, so no PUUID
  payload rides along with the error.
- `is_riot_puuid_binding_error()` recognizes it anywhere in an error chain, and
  a job that records one reports `has_puuid_binding_error()`. Player sync turns
  that into `PLAYER_ID_STALE` with an actionable message instead of the generic
  `SYNC_FAILED`. It stays a per-player warning at job level, so an unrelated
  stale row never fails a whole scheduled run.
- `PlayerService.discover_player()` repairs one player on demand: it migrates
  every stale row carrying that Riot ID onto the freshly resolved PUUID,
  repointing each table in `PUUID_REFERENCING_TABLES` before deleting the stale
  row. Searching for an affected player is therefore the supported self-service
  recovery. The migration runs before the fresh row is looked up, because a
  stale row can outlive the creation of a fresh one — match-participant
  discovery creates rows for PUUIDs seen in match payloads — and a Riot ID can
  accumulate several stale rows across repeated account changes.
- `PUUID_REFERENCING_TABLES` also covers `auth.users.puuid`, which links a user
  to a Riot account without a declared foreign key. Nothing else would move it,
  so the link would silently dangle.

Those foreign keys cascade on delete, so the migration aborts rather than
deleting a player row while any reference still points at the old PUUID. A
bulk switch still needs a deliberate migration pass; the discovery path only
heals players as they are looked up.

### Routing

Riot APIs use two routing schemas. Mixing them causes 403/404 errors.

| Type         | Use Case                       | Host Examples              | APIs                   |
| ------------ | ------------------------------ | -------------------------- | ---------------------- |
| **Regional** | Global identity, Match history | `europe.api.riotgames.com` | ACCOUNT-V1, MATCH-V5   |
| **Platform** | LoL-specific (Rank, Summoner)  | `eun1.api.riotgames.com`   | SUMMONER-V4, LEAGUE-V4 |

**Platform → Region Mappings:**

- `EUN1`, `EUW1`, `TR1`, `RU` → `EUROPE`
- `NA1`, `BR1`, `LA1`, `LA2` → `AMERICAS`
- `KR`, `JP1` → `ASIA`
- `OC1`, `PH2`, `SG2`, `TH2`, `TW2`, `VN2` → `SEA`

### Rate Limiting

- **Development Keys**: 20 req/1s AND 100 req/2min
- **Headers**: `X-App-Rate-Limit-Count`, `Retry-After`
- **Strategy**: Per-client header tracking plus database-backed coordination
  across components

#### Rate-limit layers

`backend/app/core/riot_api/rate_limiter.py` tracks every app and method window
reported by Riot response headers for an individual client. Application
windows are isolated by routing host; method windows are isolated by routing
host plus normalized service path. Counts update an active window without
moving its original local start, and a lower count starts a new window.

`backend/app/core/riot_api/db_rate_limiter.py` coordinates components through
PostgreSQL:

The `DBRateLimiter` class provides centralized rate limiting across all components
that make Riot API calls. State is stored in `core.rate_limit_state` table.

**Priority System** (lower = higher priority):
| Priority | Component | Max Wait | Description |
|----------|-----------|----------|-------------|
| 1 | PLAYER_UPDATER | 30s | Only 2 requests per run |
| 2 | MATCH_FETCHER | 2min | Few requests per player |
| 3 | MATCHMAKING_ANALYSIS | 30min | ~1100 requests per analysis |

**How it works**:

1. Before each API call, component calls `await rate_limiter.acquire()`
2. Limiter checks DB for total requests in 120s window across all components
3. If under limit AND no higher priority component active, returns `True`
4. Higher priority components "bump" lower ones (cause them to wait)
5. After API call, component calls `await rate_limiter.record_request()`

**Burst Protection**: Class-level lock ensures max 20 requests/second.

---

## 2. Currently Used Endpoints

These endpoints are actively used in the codebase (`backend/app/core/riot_api/endpoints.py`).

### ACCOUNT-V1 (Regional)

#### Get Account by Riot ID

```
GET /riot/account/v1/accounts/by-riot-id/{gameName}/{tagLine}
Host: {region}.api.riotgames.com
```

**Response:**

```json
{
  "puuid": "kO3z7...",
  "gameName": "Player",
  "tagLine": "EUW"
}
```

`puuid` is the durable identifier. The current ACCOUNT-V1 contract permits
`gameName` and `tagLine` to be omitted, so consumers must not assume that every
valid response carries a Riot ID.

**Used in**: Player search, adding tracked players

#### Get Account by PUUID

```
GET /riot/account/v1/accounts/by-puuid/{puuid}
Host: {region}.api.riotgames.com
```

**Used in**: Refreshing player name/tag, Match Fetcher job

---

### SUMMONER-V4 (Platform)

#### Get Summoner by PUUID

```
GET /lol/summoner/v4/summoners/by-puuid/{encryptedPUUID}
Host: {platform}.api.riotgames.com
```

**Documented response:**

```json
{
  "puuid": "kO3z7...",
  "profileIconId": 5367,
  "revisionDate": 1785600000000,
  "summonerLevel": 450
}
```

**Used in**: Getting summoner level, profile icon

---

### MATCH-V5 (Regional)

#### Get Match List by PUUID

```
GET /lol/match/v5/matches/by-puuid/{puuid}/ids
Host: {region}.api.riotgames.com
```

**Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `start` | int | Start index (default: 0) |
| `count` | int | Number of matches (max: 100) |
| `queue` | int | A documented `QueueType`; product jobs use 420, 440, 480, 400, 450, and 2400 |
| `type` | enum | `ranked`, `normal`, `tourney`, or `tutorial`; inclusive with `queue` |
| `startTime` | int | Epoch seconds - matches that **started after** this time (inclusive) |
| `endTime` | int | Epoch seconds - matches that **started before** this time (inclusive) |

`startTime` and `endTime` are epoch-second match-start filters. The current
official match DTO distinguishes `gameCreation` (loading-screen time) from
`gameStartTimestamp` (actual game start); do not use `gameEndTimestamp` for this
filter and do not treat `gameCreation` as the actual start field.
The client rejects negative `start`, `count` outside 0–100, unsupported queue
or type values, invalid epoch values, and reversed time ranges before I/O.

**Response:**

```json
["EUN1_1234567890", "EUN1_1234567891", ...]
```

**Used in**: Match Fetcher job, match history

#### Get Match by ID

```
GET /lol/match/v5/matches/{matchId}
Host: {region}.api.riotgames.com
```

**Response:** Full match data including:

- `metadata`: Match ID, participants list
- `info.participants[]`: All 10 players with stats, items, runes
- `info.gameVersion`: Patch version (e.g., "16.1.123")
- separate `info.gameCreation` and `info.gameStartTimestamp` values

PUUID remains the participant identity. Mode-sensitive statistics, legacy
`summonerName`, and Riot ID fields are tolerant; unknown extra provider fields
are ignored. Newly stored or refetched matches persist the actual start and
mark its source as `riot_game_start`. Existing rows are explicitly marked as
legacy creation-time fallbacks rather than silently relabeled.

**Used in**: Match Fetcher job, match details

#### Get Match Timeline by ID

```
GET /lol/match/v5/matches/{matchId}/timeline
Host: {region}.api.riotgames.com
```

**Response:** Minute-by-minute timeline with frame snapshots and event logs.

**Used in**: Match Fetcher job and re-analysis flows to build `core.match_timelines`
objective aggregates (turrets, inhibitors, dragons, heralds, barons, voidgrubs).
Atakhan columns and old compact events remain readable for pre-2026 matches,
but Atakhan is not treated as a current first-class objective. Unknown current
building or epic-monster kinds are logged with reviewed fields and retained in
compact generic events/maps for follow-up.

---

### LEAGUE-V4 (Platform)

#### Get League Entries by PUUID

```
GET /lol/league/v4/entries/by-puuid/{encryptedPUUID}
Host: {platform}.api.riotgames.com
```

**Response:**

```json
[
  {
    "queueType": "RANKED_SOLO_5x5",
    "tier": "EMERALD",
    "rank": "I",
    "leaguePoints": 45,
    "wins": 150,
    "losses": 140,
    "veteran": false,
    "inactive": false,
    "freshBlood": false,
    "hotStreak": true
  }
]
```

**Note**: Returns empty `[]` if unranked and multiple entries if the player also
has a Flex rank. Although Riot's
[League-V4 portal contract](https://developer.riotgames.com/apis#league-v4/GET_getLeagueEntriesByPUUID)
lists `leagueId` and `puuid` on a league entry, the by-PUUID response can omit
both. They are optional metadata in `LeagueEntryDTO`; `queueType`, tier, rank,
LP, win/loss, and state fields remain required. A missing `leagueId` is stored
as SQL `NULL` and does not prevent the rank snapshot from being saved.

**Used in**: Player league updates, Match Fetcher job

#### Get League Entries by Summoner ID (Legacy)

```
GET /lol/league/v4/entries/by-summoner/{encryptedSummonerId}
Host: {platform}.api.riotgames.com
```

**Note**: Prefer PUUID version. This requires getting Summoner ID first.

---

## 3. Future Endpoints (Not Yet Implemented)

These endpoints may be used in future features.

### CHAMPION-MASTERY-V4 (Platform)

| Endpoint                                                                                    | Description               |
| ------------------------------------------------------------------------------------------- | ------------------------- |
| `GET /lol/champion-mastery/v4/champion-masteries/by-puuid/{puuid}`                          | All champion masteries    |
| `GET /lol/champion-mastery/v4/champion-masteries/by-puuid/{puuid}/by-champion/{championId}` | Specific champion mastery |
| `GET /lol/champion-mastery/v4/champion-masteries/by-puuid/{puuid}/top`                      | Top champion masteries    |
| `GET /lol/champion-mastery/v4/scores/by-puuid/{puuid}`                                      | Total mastery score       |

**Potential use**: Champion pool analysis, one-trick detection

### LEAGUE-EXP-V4 (Platform)

| Endpoint                                                   | Description                           |
| ---------------------------------------------------------- | ------------------------------------- |
| `GET /lol/league-exp/v4/entries/{queue}/{tier}/{division}` | All entries in a league tier/division |

**Potential use**: Rank distribution analysis, percentile calculations

### LEAGUE-V4 Additional (Platform)

| Endpoint                                                 | Description                  |
| -------------------------------------------------------- | ---------------------------- |
| `GET /lol/league/v4/leagues/{leagueId}`                  | Full league details          |
| `GET /lol/league/v4/entries/{queue}/{tier}/{division}`   | Paginated league entries     |
| `GET /lol/league/v4/masterleagues/by-queue/{queue}`      | All Master tier players      |
| `GET /lol/league/v4/grandmasterleagues/by-queue/{queue}` | All Grandmaster tier players |
| `GET /lol/league/v4/challengerleagues/by-queue/{queue}`  | All Challenger tier players  |

**Potential use**: Leaderboards, high-elo tracking

### MATCH-V5 Available but Not Implemented (Regional)

| Endpoint                                             | Description                  |
| ---------------------------------------------------- | ---------------------------- |
| `GET /lol/match/v5/matches/by-puuid/{puuid}/replays` | Replay download URLs         |

**Potential use**: Replay download and VOD tooling. This route is currently
listed by Riot, but it has no endpoint builder, client method, or caller in this
repository.

### SPECTATOR-V5 (Platform)

| Endpoint                                                      | Description       |
| ------------------------------------------------------------- | ----------------- |
| `GET /lol/spectator/v5/active-games/by-summoner/{summonerId}` | Current live game |

**Potential use**: Live game analysis, pre-game lobby scouting

---

## 4. Endpoint Usage by Feature

### Match Fetcher Job

```
For each tracked player:
1. For each product queue 420, 440, 480, 400, 450, and 2400:
   GET /lol/match/v5/matches/by-puuid/{puuid}/ids?queue={queue}&count=100
   └── Get queue-specific match IDs

2. For each new match_id:
   └── GET /lol/match/v5/matches/{matchId}
       └── Get full match details, extract participants

3. For each fetched match:
   └── GET /lol/match/v5/matches/{matchId}/timeline
       └── Build per-participant objective aggregates

4. GET /riot/account/v1/accounts/by-puuid/{puuid}
   └── Update player game_name/tag_line

5. GET /lol/league/v4/entries/by-puuid/{puuid}
   └── Get current rank, create snapshot if changed
```

### Match History queue presentation

The frontend catalog exposes filters in this fixed order:

`All Queues | Ranked Solo/Duo | Ranked Flex | Swiftplay | Normal Draft | ARAM | ARAM: Mayhem`

`All Queues` sends no queue restriction and therefore includes every stored
supported mode, including both ARAM queues. A specific filter sends its exact
queue ID. Filter changes reset local pagination to the first 20 rows, and every
label owns a fixed width so the selected bold state cannot shift neighboring
filters. Unknown stored queue IDs remain visible as `Queue N`; they are never
silently relabeled as a supported mode.

Riot's public queue catalog identifies 2400 as ARAM: Mayhem. A secret-safe
2026-08-11 diagnostic confirmed that the selected account's local League
client history and logs contained ARAM: Mayhem play, while Match-V5 returned no
queue-2400 IDs and rejected known Mayhem match IDs. Owner QA independently
observed the same missing history on another Match-V5-backed site. The product
continues polling queue 2400 so provider-visible matches are stored
automatically. When none have been returned, Match History names the Match-V5
availability boundary instead of implying that the player did not play the
mode. Local client state and logs are diagnostic evidence only and are never an
ingestion source.

### Player Search & Tracking

The frontend uses one `Name#Tag` field for manual tracked-player input. The
field stays neutral while typing: the Track button is disabled until the value
is a valid Riot ID (exactly one separator, a game name of at most 16 permitted
characters, and an alphanumeric tag line of at most 5 characters) or identifies
a saved player by game name. Saved-player matches use their canonical PUUID with
`POST /players/{puuid}/track` instead of resolving the mutable Riot ID again.
Manual input continues through `POST /players/add-tracked`, which resolves the
Riot ID, persists/updates the canonical player, creates the current user's
tracking mapping, and queues the Player Updater and Match Fetcher work for that
player.

```
1. GET /riot/account/v1/accounts/by-riot-id/{gameName}/{tagLine}
   └── Resolve Riot ID to PUUID

2. GET /lol/summoner/v4/summoners/by-puuid/{puuid}
   └── Get summoner level, profile icon

3. GET /lol/league/v4/entries/by-puuid/{puuid}
   └── Get current rank
```

A missing Riot account is returned as `404` and presented below the Track
button as `Player {name}#{tag} wasn't found on server {server}.` A `429` is
shown as a warning toast, while an invalid Riot API key uses the existing
credential-error toast rather than exposing a server error.

Background Matchmaking Analysis calls cannot return the original Riot `401` or
`403` on the already-completed start request. Instead, they persist
`error_code=RIOT_API_KEY_INVALID` on the failed run. The shared Axios response
interceptor recognizes that code in the HTTP 200 lifecycle payload and activates
the same global invalid/expired-key header. Pending/in-progress lifecycle
responses are neutral; they do not prove the credential is valid.

### Player League Refresh

```
1. GET /lol/league/v4/entries/by-puuid/{puuid}
   └── Fetch latest rank

2. Compare with latest core.player_leagues record
   └── If different: Insert new snapshot
      (`league_id` may be null when Riot omits it)
```

---

## 5. Error Handling

| Status | Error        | Handling                                    |
| ------ | ------------ | ------------------------------------------- |
| 400    | Bad Request  | Invalid parameters - check request          |
| 401    | Unauthorized | API key invalid - update in Settings        |
| 403    | Forbidden    | API key expired or insufficient permissions |
| 404    | Not Found    | Player/match doesn't exist                  |
| 429    | Rate Limited | Wait for `Retry-After` seconds              |
| 500+   | Server Error | Retry with exponential backoff              |

### Rate Limit Response Headers

```
X-App-Rate-Limit: 20:1,100:120
X-App-Rate-Limit-Count: 15:1,80:120
Retry-After: 5
```

---

## 6. Implementation Notes

### RiotAPIClient (`backend/app/core/riot_api/client.py`)

- Async HTTP client using `httpx`
- Automatic rate limit handling with `Retry-After`
- Response validation via Pydantic DTOs
- Request callback for metrics tracking

### Endpoint Building (`backend/app/core/riot_api/endpoints.py`)

- `RiotAPIEndpoints` class constructs full URLs
- Handles region/platform routing automatically
- Query parameter building for match list

### Constants (`backend/app/core/riot_api/constants.py`)

- `Region` enum: EUROPE, AMERICAS, ASIA, SEA
- `Platform` enum: EUN1, EUW1, NA1, KR, etc.
- `QueueType` follows Riot's maintained queue dataset. The narrower product
  allowlist is 420, 440, 480, 400, 450, and 2400. Match Fetcher always uses
  the complete allowlist; other documented modes are not enabled automatically.
- `get_region_by_platform()`: Platform → Region mapping that rejects unknown
  platforms rather than defaulting to Europe.

### Data Dragon assets

The root layout resolves the first valid version from Riot's public
`versions.json` manifest with a six-hour Next.js revalidation interval and
provides it to client components. Versioned champion, item, spell, and profile
assets use that value. A reviewed `16.15.1` fallback keeps existing assets
available if the manifest is unavailable or malformed; unknown spell/rune IDs
remain non-renderable instead of constructing speculative URLs.

---

## 7. Best Practices

1. **Always use PUUID** - It's permanent; game names change
2. **Batch requests** - Don't fire parallel requests, queue them
3. **Respect rate limits** - honor Riot's application, method, service, region,
   and `Retry-After` signals; do not rely on a single fixed delay
4. **Check queue types** - 420=Solo/Duo, 440=Flex, etc.
5. **Filter by release year** - In 2026, accept `game_version.startswith("16.")`
6. **Handle empty responses** - League entries return `[]` for unranked players
