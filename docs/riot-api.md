# Riot API Reference

> **Authority:** Riot API routing, credential precedence and health, response
> contract boundaries, and rate-limit behavior used by League Analysis.
>
> **Maintenance:** Update when a durable invariant, a decision rationale, an
> externally observed Riot contract fact, or an operational procedure recorded
> here changes. Endpoint signatures, DTO shapes, and caller inventories live in
> `backend/app/core/riot_api/` and are not mirrored here.

The dated [2026-08-03 compatibility audit](riot-api-compatibility-2026-08-03.md)
records the evidence basis and remediation scope implemented by LGA-42.
Sanitized protected fixtures captured on 2026-08-08 cover the used Account,
Summoner, Match, and Timeline shapes for queues 400, 420, 440, and 450.
Transparent synthetic variants derived from those fixtures verify queue
identity and tolerant contract handling for Swiftplay 480 and ARAM: Mayhem
2400 without claiming a new protected-provider capture.

**Contract-drift audit recipe:** re-check this document's external claims
against Riot's official machine-readable
[queues](https://static.developer.riotgames.com/docs/lol/queues.json),
[maps](https://static.developer.riotgames.com/docs/lol/maps.json),
[gameModes](https://static.developer.riotgames.com/docs/lol/gameModes.json),
and
[gameTypes](https://static.developer.riotgames.com/docs/lol/gameTypes.json)
datasets plus Data Dragon's
[version manifest](https://ddragon.leagueoflegends.com/api/versions.json) and
[realm manifests](https://ddragon.leagueoflegends.com/realms/eune.json). These
are the sources the 2026-08-03 audit used and the first place contract drift
becomes visible.

---

## 1. Core Concepts

### Authentication and development-key limits

- **Header**: `X-Riot-Token: RGAPI-...`
- Development keys expire every **24 hours**.
- Development-key application limits: **20 requests / 1 s** and
  **100 requests / 120 s**.
- Application, method, and service limits are **distinct** and each is scoped
  per routing region/platform host. Rate windows start at the **first request**
  in the window, not on a fixed clock.
- Honor Riot's application, method, service, and `Retry-After` signals; never
  rely on a single fixed delay.

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
- ACCOUNT-V1 **Get Account by Riot ID** (`game_name` and `tag_line` are stored
  in `core.players`) resolves the player's current PUUID under the current key.
  That resolution alone is **not** a repair: remapping the stored PUUID and its
  referencing rows requires reviewed operator evidence that the two PUUIDs are
  the same Riot account, because a Riot ID can also have changed hands. See
  [Why discovery never merges two rows automatically](#why-discovery-never-merges-two-rows-automatically).

Plan any future switch of the production key to a different developer account
(for example after Riot application review) as a data migration, not a
configuration change.

#### How the code detects the condition

- The client inspects Riot's `status.message` on a 400 and raises
  `PuuidDecryptionError` (a `BadRequestError` subclass) when it reports a
  decryption failure. The condition travels as an exception type, so no PUUID
  payload rides along with the error.
- `is_riot_puuid_binding_error()` recognizes it anywhere in an error chain, and
  a job that records one reports `has_puuid_binding_error()`. Player sync turns
  that into `PLAYER_ID_STALE` with an actionable message instead of the generic
  `SYNC_FAILED`. It stays a per-player warning at job level, so an unrelated
  stale row never fails a whole scheduled run.
- `PlayerService.discover_player()` deliberately does **not** repair the row. It
  inserts or updates the freshly resolved PUUID and leaves any row carrying the
  same Riot ID under a different PUUID untouched, so a duplicate player row is
  the visible outcome.

#### Why discovery never merges two rows automatically

These two states are indistinguishable from inside discovery:

- the same player, whose PUUID was re-encrypted under a new developer account;
- a different player, who claimed a Riot ID its previous owner renamed away
  from.

Riot permits a Riot ID change whenever the complete `gameName#tagLine` is free,
and `core.players` accumulates at-match-time Riot IDs for every participant ever
ingested, so the second state is reachable in normal operation. Every table
referencing `core.players(puuid)` cascades on delete, so an automatic merge that
guessed wrong would move one player's match, league, analysis, and tracking rows
onto another player and delete the original. A duplicate row is recoverable; a
wrong merge is not.

A live check on the superseded PUUID is not sufficient authorization either. A
decryption 400 proves only that the stored PUUID belongs to another developer
account's namespace; it cannot prove that the name-resolved PUUID is the same
Riot account. Treat it as a veto, never as permission.

Repair any stale population through an explicit operator-run pass with a
reviewed old-to-new mapping, built from immutable correlation (for example the
same stored match ID and participant slot re-fetched under the new key) or from
dual-key evidence captured during a planned cutover. Rows without reliable
evidence stay untouched.

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

`get_region_by_platform()` rejects unknown platforms rather than defaulting to
Europe.

---

## 2. Credential Precedence and Health Authority

Credential resolution selects the newest active, non-expired row in
`core.riot_api_keys`, then falls back to the `RIOT_API_KEY` environment
variable when no usable database key exists. The backend owns one secret-free
`core.riot_credential_health` record for that effective credential generation.
Its state is `missing`, `unknown`, `valid`, or `invalid`.

Saving a provider-validated database key establishes a fresh/current valid
generation. Replacing the effective key resets old evidence; a request from an
older generation cannot overwrite the new state. Within a generation,
request-start timestamps prevent a slow old response from overwriting newer
evidence.

Direct Riot `2xx` responses and authenticated `404` responses prove `valid`.
Direct Riot `401` and `403` responses prove `invalid`. `400`, `429`, `5xx`,
timeouts, connection failures, cached data, local database reads, accepted
background work, and completed polling responses are neutral. All effective
runtime clients must be created with `create_tracked_riot_api_client()` (or the
FastAPI dependency that uses it); the candidate-key validation call before a
save is deliberately separate.

For the environment fallback, `RIOT_API_KEY_VERSION` is an optional non-secret
deployment generation such as `production-2026-08-11-1`. Change it whenever
`RIOT_API_KEY` changes, then restart the backend so both values are reloaded. It
must contain only 1-64 letters, numbers, dots, underscores, or hyphens and must
never contain the key. Without this variable, each backend process start uses a
new random generation, safely returning health to `unknown` until Riot directly
accepts or rejects the credential. No key hash, prefix, suffix, or other
key-derived fingerprint is persisted or returned.

Both admin and non-admin headers read `/api/v1/settings/service-status`.
Browser refresh, another tab, polling, and exact invalid-key lifecycle signals
therefore converge on the same durable backend state. Dismissal identifiers use
the safe health revision, so dismissing one incident cannot suppress a later
one.

Background Matchmaking Analysis calls cannot return the original Riot `401` or
`403` on the already-completed start request. Instead, they persist
`error_code=RIOT_API_KEY_INVALID` on the failed run. The shared Axios response
interceptor recognizes that code in the HTTP 200 lifecycle payload and asks the
shared credential-health queries to refresh. Pending, completed, cached, and
local lifecycle responses are all neutral; only a direct Riot response is
credential evidence.

---

## 3. Rate Limiting

Two coordinated layers exist. Never bypass either one: every Riot call must go
through the DB limiter's `acquire()`/`record_request()` pair, keep the burst
spacing lock, and honor `Retry-After` on 429.

**Per-client adaptive tracking**
(`backend/app/core/riot_api/rate_limiter.py`): tracks every app and method
window reported by Riot response headers for an individual client. Application
windows are isolated by routing host; method windows by routing host plus
normalized service path. Counts update an active window **without moving its
original observed local start**; a lower count starts a new window.

**Cross-component coordination**
(`backend/app/core/riot_api/db_rate_limiter.py`): `DBRateLimiter` coordinates
all Riot-calling components through the `core.rate_limit_state` table.

| Priority | Component            | Max Wait | Rationale                    |
| -------- | -------------------- | -------- | ---------------------------- |
| 1        | PLAYER_UPDATER       | 30 s     | Only 2 requests per run      |
| 2        | MATCH_FETCHER        | 2 min    | Few requests per player      |
| 3        | MATCHMAKING_ANALYSIS | 30 min   | ~1100 requests per analysis  |

Higher-priority components bump lower ones (which yield and retry). A
class-level lock enforces 50 ms minimum spacing, i.e. at most 20 requests per
second process-wide.

Do not modify Riot API rate-limiting behavior unless a task explicitly scopes
that work (repository-wide rule).

---

## 4. Riot Contract Nuances (Externally Observed)

These are provider behaviors that cannot be derived from our code and must not
be "fixed" away:

- **LEAGUE-V4 by-PUUID** can omit `leagueId` and `puuid` live even though the
  portal contract lists them. They are optional metadata in `LeagueEntryDTO`;
  `queueType`, tier, rank, LP, win/loss, and state fields remain required. A
  missing `leagueId` is stored as SQL `NULL` and does not prevent the rank
  snapshot from being saved. Unranked players return `[]`; Flex adds a second
  entry.
- **ACCOUNT-V1** responses may omit `gameName` and `tagLine`. Persistence
  preserves the already-known Riot ID rather than overwriting it with nothing;
  legacy `summonerName` is only a fallback for a new record or display, never
  an overwrite of a known Riot ID.
- **Match timestamps**: `gameCreation` is the loading-screen time;
  `gameStartTimestamp` is the actual game start; `gameEndTimestamp` may be
  absent. MATCH-V5 `startTime`/`endTime` list filters are epoch-second
  match-start filters. Newly stored or refetched matches persist the actual
  start and mark its source `riot_game_start`; existing rows are explicitly
  marked as legacy creation-time fallbacks rather than silently relabeled.
- **Timeline event payload keys are undocumented by Riot.** The portal
  documents only a small generic event surface. Our timeline handling is
  verified only by the sanitized fixtures captured 2026-08-08 for queues 400,
  420, 440, and 450, plus synthetic 480/2400 variants. Capture fresh fixtures
  before changing strict DTO or timeline behavior. Unknown current building or
  epic-monster kinds are logged with reviewed fields and retained in compact
  generic events/maps for follow-up.
- **Atakhan was removed in patch 26.1** (with Blood Roses and Feats of
  Strength). Atakhan columns and old compact events remain readable for
  pre-2026 matches, but Atakhan is not a current first-class objective.
- **ARAM: Mayhem (queue 2400) Match-V5 availability boundary.** Riot's public
  queue catalog identifies 2400 as ARAM: Mayhem. A secret-safe 2026-08-11
  diagnostic confirmed the selected account's local League client history and
  logs contained Mayhem play while Match-V5 returned no queue-2400 IDs and
  rejected known Mayhem match IDs; owner QA independently observed the same
  gap on another Match-V5-backed site. The product keeps polling queue 2400 so
  provider-visible matches are stored automatically; when none have been
  returned, Match History names the Match-V5 availability boundary instead of
  implying the player did not play the mode. Local client state and logs are
  diagnostic evidence only and are **never an ingestion source**.

### Endpoint ownership note

Riot ID (`game_name`/`tag_line`) refresh via ACCOUNT-V1 by-PUUID is the
**Player Updater** job's responsibility (`PlayerService.update_player_profile`
driven by `PlayerUpdaterJob`), together with SUMMONER-V4 icon/level refresh.
The Match Fetcher deliberately does not update player profiles; it syncs
matches, timelines, and league snapshots.

---

## 5. Queues, Validation, and the Season Boundary

- `QueueType` in `backend/app/core/riot_api/constants.py` follows Riot's
  maintained queue dataset as a **reference catalog**. The narrower **product
  allowlist** is 420 (Solo/Duo), 440 (Flex), 480 (Swiftplay), 400 (Normal
  Draft), 450 (ARAM), and 2400 (ARAM: Mayhem). Match Fetcher always uses the
  complete allowlist; other documented modes are not enabled automatically.
  Keep the catalog and the allowlist separate: cataloging a queue must never
  silently enable it.
- The client validates match-list inputs **before I/O**: it rejects negative
  `start`, `count` outside 0–100, unsupported queue or type values, invalid
  epoch values, and reversed time ranges. Unknown stored queue IDs stay visible
  as `Queue N` in the UI; they are never silently relabeled as a supported
  mode.
- **Season boundary:** accepting only `game_version.startswith("16.")`
  (`MatchService.CURRENT_GAME_VERSION_PREFIX`) is a deliberate hard-coded
  product decision for the 2026 season. Changing it is a reviewed change, not
  a config tweak.

---

## 6. Data Dragon

The root layout resolves the first valid version from Riot's public
`versions.json` manifest with a six-hour Next.js revalidation interval and
provides it to client components. A reviewed `16.15.1` fallback keeps existing
assets available if the manifest is unavailable or malformed; unknown spell and
rune IDs remain non-renderable (`null`) instead of constructing speculative
URLs.
