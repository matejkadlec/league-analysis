# Riot API Compatibility Audit - 2026-08-03

> **Scope:** Read-only compatibility analysis for `LGA-7`. No endpoint, DTO,
> schema, job, or UI behavior was changed by this audit.
>
> **Authority:** This report records the dated evidence and implementation delta.
> [`riot-api.md`](riot-api.md) remains the maintained integration reference.

Implementation is tracked by
[LGA-42](https://envelopment.atlassian.net/browse/LGA-42), **Update Riot API
endpoint calls and data contracts**, in Sprint 2601.

## Verification basis and limits

The contract was checked on **2026-08-03** against these official Riot sources:

- [Riot Developer Portal API reference](https://developer.riotgames.com/apis)
  for ACCOUNT-V1, SUMMONER-V4, MATCH-V5, and LEAGUE-V4 paths and DTOs;
- [League of Legends developer documentation](https://developer.riotgames.com/docs/lol)
  for routing, Riot ID/PUUID guidance, and Data Dragon;
- [Developer Portal policies](https://developer.riotgames.com/docs/portal)
  for key lifetime, rate-limit scopes, windows, and response headers;
- Riot's machine-readable [queue](https://static.developer.riotgames.com/docs/lol/queues.json),
  [map](https://static.developer.riotgames.com/docs/lol/maps.json),
  [game-mode](https://static.developer.riotgames.com/docs/lol/gameModes.json), and
  [game-type](https://static.developer.riotgames.com/docs/lol/gameTypes.json)
  datasets;
- Data Dragon's [version manifest](https://ddragon.leagueoflegends.com/api/versions.json)
  and [EUNE realm](https://ddragon.leagueoflegends.com/realms/eune.json);
- Riot's [Patch 26.1 notes](https://www.leagueoflegends.com/en-us/news/game-updates/patch-26-1-notes/)
  for the removal of Atakhan, Blood Roses, and Feats of Strength.

The public JSON datasets were fetched successfully. They reported Data Dragon
`16.15.1` and the queue/mode values recorded below.

A representative authenticated response could not be captured safely. A request
with the configured environment credential returned HTTP 401, and the database
named by the local configuration was unavailable, so no database-priority key was
available. No key or environment value was printed, copied, or changed. Therefore:

- field presence and optionality below are **documented contract**, not a claim
  about an observed protected response;
- timeline event payload keys remain an **observed-code dependency** because the
  portal documents only a small generic event surface;
- the implementation task must capture sanitized fixtures with a current key
  before changing strict DTO or timeline behavior.

## Current application integration

### Endpoint and caller inventory

All HTTP calls are built by `RiotAPIEndpoints` in
`backend/app/core/riot_api/endpoints.py`, sent by `RiotAPIClient` in
`backend/app/core/riot_api/client.py`, and authenticated with `X-Riot-Token`.

| Client method and implemented route | Routing | Callers and behavior that consume it |
| --- | --- | --- |
| `get_account_by_riot_id()` -> `GET /riot/account/v1/accounts/by-riot-id/{gameName}/{tagLine}` | Regional | `PlayerService.fetch_and_track_player()` resolves a submitted Riot ID to PUUID, persists `game_name`/`tag_line`, and then requests the platform Summoner record. Player routes construct the client. `SettingsService` builds the same route directly and sends it through `_make_request()` as an API-key authentication probe; an expected 404 is accepted as proof that authentication succeeded. |
| `get_account_by_puuid()` -> `GET /riot/account/v1/accounts/by-puuid/{puuid}` | Regional | `PlayerService.update_player_profile()`, `PlayerUpdaterJob`, and `TestRunnerJob` refresh the mutable Riot ID attached to an existing PUUID. |
| `get_summoner_by_puuid()` -> `GET /lol/summoner/v4/summoners/by-puuid/{puuid}` | Platform | Player add/track, profile refresh, `PlayerUpdaterJob`, `TestRunnerJob`, and related routes consume profile icon and summoner level. |
| `get_match_list_by_puuid()` -> `GET /lol/match/v5/matches/by-puuid/{puuid}/ids` | Regional | Match sync/fetch/re-analysis flows, `MatchFetcherJob`, `TestRunnerJob`, manual background analysis, and `MatchmakingAnalysisService` discover match IDs. Callers use `start`, `count`, queue IDs, and matchmaking uses `endTime` as a historical anchor. |
| `get_match()` -> `GET /lol/match/v5/matches/{matchId}` | Regional | Match sync, match fetcher, re-analysis, `get_or_fetch_match()`, `TestRunnerJob`, and matchmaking analysis validate `MatchDTO`, persist match/participant rows, and derive profile and matchmaking statistics. |
| `get_match_timeline()` -> `GET /lol/match/v5/matches/{matchId}/timeline` | Regional | Match sync/fetch/re-analysis, `get_or_fetch_match()`, and `TestRunnerJob` pass raw dictionaries to `features/matches/timeline.py` for objective aggregates and compact event logs. |
| `get_league_entries_by_puuid()` -> `GET /lol/league/v4/entries/by-puuid/{puuid}` | Platform | Player league refresh and `MatchFetcherJob` select `RANKED_SOLO_5x5`, persist league snapshots, and infer LP changes; `TestRunnerJob` also probes it. |
| `get_league_entries_by_summoner_id()` -> `GET /lol/league/v4/entries/by-summoner/{summonerId}` | Platform | Implemented client wrapper only; no production caller was found. It is a legacy alternative to the PUUID route. |

The official MATCH-V5 reference also exposes
`GET /lol/match/v5/matches/by-puuid/{puuid}/replays`; the application does not
build or call it. Its earlier mention under “future endpoints” is capability
planning, not an implicit runtime dependency.

The Settings authentication probe is the only caller found that bypasses a
public endpoint wrapper. It still uses the shared endpoint builder, HTTP client,
retry, header-limit, and error mapping. It intentionally tests a non-existent
account so that either a 200 or an authenticated 404 establishes key validity.

### Routing, parameters, and request behavior

The implemented platform list and platform-to-region table match Riot's current
LoL routing list:

- `BR1`, `LA1`, `LA2`, `NA1` -> `AMERICAS`;
- `JP1`, `KR` -> `ASIA`;
- `EUN1`, `EUW1`, `RU`, `TR1` -> `EUROPE`;
- `OC1`, `PH2`, `SG2`, `TH2`, `TW2`, `VN2` -> `SEA`.

ACCOUNT-V1 and MATCH-V5 require regional hosts. SUMMONER-V4 and LEAGUE-V4
require platform hosts. The central mapper is correct, but player services also
repeat the mapping as hand-written conditionals and silently default unknown
platforms to Europe. That duplication can drift.

MATCH-V5 match-list parameters are currently:

| Parameter | Official contract | Application behavior |
| --- | --- | --- |
| `start` | Optional result offset; default `0`. | Always sent; callers use `0` or page offsets. |
| `count` | Optional result count; default `20`, range `0..100`. | Always sent; callers request up to `100`. No client-side range validation. |
| `queue` | Optional queue ID. | An integer must exist in `QueueType`; an unknown value is silently converted to no filter. |
| `type` | Optional `ranked`, `normal`, `tourney`, or `tutorial`; inclusive with `queue`. | Passed through as an arbitrary string and rarely used. No enum or validation. |
| `startTime`, `endTime` | Optional epoch seconds delimiting match start time. | Added only for truthy values. Matchmaking uses `endTime` to fetch a player's prior matches. |

The previous documentation tied the time filters specifically to
`info.gameCreation`. The current reference describes match start time but does
not guarantee that it is the `gameCreation` field; code and documentation must
use `info.gameStartTimestamp` for actual start semantics.

### Response, persistence, and consumer path

`backend/app/core/riot_api/models.py` validates Account, Summoner, match, match
participant, and league responses with Pydantic. Timeline data is intentionally
left as an untyped dictionary. The validated/transformed data then flows through:

- `backend/app/core/riot_api/transformers.py` and
  `backend/app/features/matches/transformers.py`;
- `backend/app/features/players/`, `matches/`, and `matchmaking_analysis/`;
- Alembic revisions under `backend/alembic/versions/`, including match
  timestamps, participants, league snapshots, rate-limit state, and timeline
  objective columns/JSON;
- background jobs in `backend/app/features/jobs/implementations/`;
- backend response schemas and the frontend profile, player, and match features.

The frontend treats queue `400`, `420`, `430`, `440`, and `450` as named modes,
offers filters for `400`, `420`, and `440`, and shows other IDs as `Queue N`.
Data Dragon URLs for champions, profile icons, items, spells, and runes are all
derived from the single hard-coded version in `frontend/lib/core/data-dragon.ts`.

Timeline extraction recognizes `BUILDING_KILL` and `ELITE_MONSTER_KILL`, then
derives turret, inhibitor, dragon, Rift Herald, Baron, Void Grub, Atakhan, and
unknown epic-monster aggregates. The database has dedicated Atakhan participant
and team columns. The current match-history UI presents turret, inhibitor,
dragon, Void Grub, Herald, and Baron totals; it does not present Atakhan.

### Retry, throttling, and errors

The HTTP client maps 400, 401, 403, and 404 to domain errors; retries 429 using
`Retry-After`; and retries transport, timeout, and 5xx failures with bounded
backoff. It parses application and method rate-limit headers.

Riot documents application, method, and service limits as distinct and scoped by
region. Rate windows begin with the first request in the window. Two application
layers need reconciliation:

- `RateLimiter` estimates each reset as response receipt time plus the complete
  window, which can over-wait and does not reconstruct Riot's bucket start;
- `DBRateLimiter` applies one hard-coded 20/second and 100/120-second development
  budget across all components and routing regions, independently of the limits
  reported for the active key.

The conservative database layer reduces burst risk but is not a faithful model
of regional or non-development-key quotas.

## Current official contract summary

| API | Current documented response facts relevant to this repository |
| --- | --- |
| ACCOUNT-V1 | `puuid` is present. `gameName` and `tagLine` may both be excluded; Riot ID should be treated as mutable display identity. |
| SUMMONER-V4 by PUUID | Documents `profileIconId`, `revisionDate`, `puuid`, and `summonerLevel`. It no longer promises legacy `id`, `accountId`, or `name` here. |
| MATCH-V5 match | `gameCreation` is loading-screen time; `gameStartTimestamp` is actual game start; `gameEndTimestamp` may be absent. Participant data includes Riot ID fields and `summonerName`, but Riot's LoL guidance says summoner names are stale and Riot ID/PUUID should be preferred. `challenges` and many mode-sensitive fields are not safe as universal required inputs. |
| MATCH-V5 timeline | Top-level metadata/info/frames and generic event timestamps/types are documented. The objective-specific keys consumed by this repository are not fully specified in the portal schema and require fixture verification. |
| LEAGUE-V4 by PUUID | Returns zero or more entries with PUUID, queue, tier/rank/LP, win/loss and status flags, plus optional `miniSeries`; it does not require legacy summoner ID/name. |

As of the verification date, Riot's queue dataset includes the application's core
queues unchanged: `400` Draft Pick, `420` Ranked Solo/Duo, `430` Blind Pick,
`440` Ranked Flex, and `450` ARAM. It also includes newer live queues such as
`480` Swiftplay, `490` Quickplay, `2300` Brawl, and `2400` ARAM: Mayhem.

The local `QueueType` event/tutorial portion is materially stale. Examples:

| ID | Local name | Official current description |
| --- | --- | --- |
| `450` | both `NORMAL_BLIND_PICK_3X3` and `ARAM` | ARAM |
| `610` | One for All | Dark Star: Singularity |
| `700` | Poro King | Summoner's Rift Clash |
| `720` | Nexus Siege | ARAM Clash |
| `830`, `840` | ARURF, PROJECT | deprecated bot queues |
| `870`, `880` | Snow URF, Odyssey | current bot queues |
| `2000`, `2010`, `2011`, `2012` | practice/tutorial labels | `2000`, `2010`, and `2020` are the documented tutorial queues; the local names and IDs do not align |

IDs `620`, `630`, `640`, `650`, and `860` are absent from the current queue
dataset under the local meanings. Current rotating-mode IDs such as `900` ARURF,
`920` Poro King, `940` Nexus Siege, `1000` PROJECT, `1020` One for All,
`1300` Nexus Blitz, `1400` Ultimate Spellbook, `1700`/`1710` Arena, and
`1900` Pick URF are absent locally.

## Compatibility delta

| ID | Area and current behavior | Current delta and effect | Required follow-up | Risk/order |
| --- | --- | --- | --- | --- |
| C-01 | `MatchInfoDTO.game_start_timestamp` and both match transformers read `gameCreation`; `core.matches.game_start_timestamp` drives ordering, date filters, history, analysis anchors, indexes, and API output. | Riot distinguishes loading-screen `gameCreation` from actual `gameStartTimestamp`. Existing rows and derived time windows have the wrong semantic label and can be offset from actual match start. | Capture both fields, define migration/backfill policy, update DTOs/transformers/schema/queries/schemas/tests/docs, and decide how legacy rows without refetch are represented. | **Critical; first.** It affects persisted truth and matchmaking history selection. |
| C-02 | `AccountDTO` requires `gameName` and `tagLine`; player add/update directly persists them. | The current contract permits both fields to be absent. A valid response can fail Pydantic validation or overwrite assumptions in player flows. | Make fields optional, define display-name fallback/retention rules, prevent null regressions, and add omitted-field fixtures and tests. | **High; second.** Can break identity refresh and tracking. |
| C-03 | `QueueType` gates every match-list queue filter and silently removes unknown IDs. | Many names/IDs are stale, `450` is duplicated, new live queues are absent, and an unknown requested queue broadens the request instead of failing. Jobs currently use valid IDs, but future/configured queues can fetch unintended matches. | Replace constants from Riot's dataset, separate supported product queues from the reference catalog, reject unsupported filters, and test job/config/UI behavior. | **High; second.** Silent broadening is a data-integrity risk. |
| C-04 | Timeline code and SQL schema retain dedicated Atakhan fields and event handling. | Riot removed Atakhan in Patch 26.1. New matches will not populate it; keeping first-class current semantics misleads analyses and increases schema/UI contract noise. Historical records may still contain it. | Define historical retention, remove it from current aggregates/contracts, migrate or deprecate columns safely, preserve old compact events if required, and update timeline/schema/docs/tests. | **High; after fixture capture.** Schema/data decision required. |
| C-05 | Timeline parsing relies on undocumented event-specific keys and accepts unknown epic monsters only in generic maps. | Riot's portal does not guarantee the full keys used for killer/team/assist and objective subtype extraction. New objectives or changed event shapes can silently undercount. | Capture sanitized current timelines for supported queues, add typed tolerant parsing/fixture tests, record unknowns, and alert on new event/monster types. | **High; before objective migration.** Current live payload needed. |
| C-06 | Frontend Data Dragon version is fixed at `15.2.1`. | Current manifest/realm reported `16.15.1`. New champion, item, rune, spell, and profile-icon assets can fail or be wrong. | Use a controlled current-version source with caching/fallback, test URL generation and fallback behavior, and document the update policy. | **High; independent early fix.** User-visible broken assets. |
| C-07 | Strict `ParticipantDTO` requires a broad set of fields across all modes. | MATCH-V5 fields can vary by mode and evolve; Riot ID is preferred while `summonerName` is stale. A single missing required statistic can reject a complete match. | Compare sanitized fixtures across supported queues, make non-contractual fields tolerant, retain PUUID as identity, and add missing/extra-field tests. | **High; with C-01/C-02.** Whole-match ingestion can fail. |
| C-08 | Header limiter derives reset time as “response time + window.” | Riot says the window starts on the first request, so this is conservative but inaccurate and may stall longer than necessary. | Track bucket state consistently or rely on counts plus `Retry-After`; add deterministic multi-window tests. | **Medium; after data correctness.** Availability/throughput. |
| C-09 | DB limiter hard-codes development-key quotas globally across components. | Riot limits vary by key, method/service, and routing region. The layer can over-throttle and does not adapt to reported limits. | Key state by application/routing scope, reconcile it with Riot headers, retain component priorities, and test concurrent jobs. | **Medium; after C-08 design.** Throughput and coordination. |
| C-10 | Player services duplicate platform-region conditionals and default unknown values to Europe. | The central mapping is correct today, but duplicated fail-open routing can drift and produce confusing 403/404 results. | Use `get_region_by_platform()` everywhere and reject unsupported platforms before making requests. | **Medium; low-complexity early fix.** Routing correctness. |
| C-11 | Match-list `type` is unvalidated and `count` is not bounded client-side. | Invalid values reach Riot as 400 responses. Queue and type are inclusive, but callers do not express that contract. | Add enums/range checks and boundary tests; keep combined queue/type behavior explicit. | **Medium.** Predictable request validation. |
| C-12 | `LeagueEntryDTO` ignores `miniSeries` and preserves optional legacy summoner fields. | Ignoring `miniSeries` is safe for current features, while legacy fields blur the by-PUUID contract. | Decide whether promotion-series UI/analysis needs the data; otherwise document intentional ignore and separate endpoint DTOs if legacy wrapper remains. | **Low.** No current feature break. |
| C-13 | Current docs list the replay route as a future endpoint. | The route is present in the current official MATCH-V5 API, but remains unimplemented and unused locally. | Keep it explicitly classified as available/not implemented; add code only with a product requirement and verified response contract. | **Low.** Documentation accuracy. |
| C-14 | No authenticated current fixture was available during this audit. | Strict response and event assumptions could not be confirmed against a successful protected response. | Make current sanitized Account, Summoner, Match, Timeline, and League fixtures an explicit prerequisite for DTO/timeline implementation. | **Gate for C-02/C-05/C-07.** Do not infer payloads. |

## LGA-42 implementation resolution (2026-08-08)

LGA-42 completed the audited runtime scope with sanitized protected fixtures:

- C-01 marks existing timestamps as explicit legacy creation-time fallbacks and
  stores separate creation/actual-start values for new or refetched matches.
- C-02/C-07 preserve PUUID identity, tolerate optional current fields, retain
  known Riot IDs, and accept unknown extra participant fields.
- C-03/C-10/C-11 update routing/queue catalogs and fail closed on invalid
  platform, queue, type, pagination, and epoch inputs. Product support remains
  limited to queues 400, 420, 440, and 450.
- C-04/C-05 retain historical Atakhan data while routing unexpected current
  objectives through logged generic retention.
- C-06 resolves the current Data Dragon manifest with caching and a reviewed
  fallback.
- C-08/C-09 keep cross-component database priority while tracking header-driven
  app/method windows by routing and service scope without extending an active
  window on every response.
- C-12 remains intentional: the current product has no promotion-series
  consumer, and the legacy by-summoner DTO stays separate.

The replay route remains documented and intentionally unimplemented (C-13).

## Required implementation scope and order

The follow-up implementation should proceed in this order:

1. Obtain a current development or approved production key outside source
   control; capture sanitized fixtures for all used endpoints and queues 400,
   420, 440, and 450 where available. Add contract tests before modifying DTOs.
2. Resolve C-01's persisted timestamp semantics. Prefer storing
   `gameCreation` and `gameStartTimestamp` separately; migrate schema and code
   incrementally, and document whether legacy rows are refetched, marked, or
   retained with legacy semantics.
3. Make Account and participant DTOs tolerant according to the documented
   contract plus captured fixtures. Keep PUUID as the durable identity and add
   explicit Riot-ID fallback behavior.
4. Replace the queue catalog and fail closed on unsupported filters. Verify job
   configuration and frontend labels without automatically enabling new modes.
5. Rework timeline/objective handling using current fixtures. Preserve needed
   historical Atakhan data while removing it from current-game assumptions and
   exposing unknown objectives safely.
6. Reconcile per-client and database rate limiting with application, method,
   service, and routing scopes; preserve the existing job priority policy.
7. Replace the fixed Data Dragon pin with a controlled version-resolution and
   cache/fallback strategy.
8. Update this reference, nearby scoped `AGENTS.md` files if their durable
   guidance changes, database documentation, job documentation, and user-facing
   contracts together with the implementation.

### Concrete files and components

At minimum, implementation review must cover:

- `backend/app/core/riot_api/{client,constants,endpoints,models,rate_limiter,db_rate_limiter,transformers}.py`;
- `backend/app/core/{config,dependencies,match_utils}.py`;
- `backend/app/features/players/`, `backend/app/features/matches/`, and
  `backend/app/features/matchmaking_analysis/`;
- `backend/app/features/jobs/implementations/{match_fetcher,player_updater,test_runner}.py`
  and queue configuration;
- Alembic revisions and `docs/database.md` for any timestamp/objective schema
  change;
- `frontend/lib/core/data-dragon.ts`, match/profile/player consumers, and their
  tests;
- Riot boundary, job, match, timeline, player, and analysis tests plus sanitized
  fixtures;
- `docs/riot-api.md`, `docs/jobs.md`, and applicable scoped `AGENTS.md` files.

### Validation plan

The implementation ticket must require:

- fixture-based DTO tests for optional/extra fields and all used endpoint types;
- endpoint tests for every routing group, encoded path input, queue/type
  validation, pagination bounds, and epoch-second filters;
- migration tests or read-back checks for timestamp and objective data;
- timeline fixtures covering every supported current objective plus unknown
  event/monster fallback;
- deterministic rate-limit tests for app/method scopes, multiple windows,
  `Retry-After`, routes, and concurrent job priorities;
- frontend tests for version resolution, asset fallback, queue labels, and
  historical objective presentation;
- focused backend/frontend gates during development and the complete `./test.sh`
  gate before publication.

## Explicit non-findings

- The currently used endpoint paths and regional/platform host families still
  exist in the official API.
- The application's core queue IDs 400, 420, 430, 440, and 450 remain current;
  their narrow product usage does not need to expand merely because new queues
  exist.
- The platform enum and central platform-to-region mapping match the current
  official routing list.
- League-by-PUUID returning an empty list for an unranked player remains a valid
  handled case.
- The replay endpoint is not called implicitly; no replay implementation is
  required for compatibility of the current application.
