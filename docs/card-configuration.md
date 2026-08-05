# Configurable Card Catalog and Settings Contract

> **Status:** Owner-approved LGA-23 contract. It authorizes follow-up
> persistence, API, calculation, and frontend work in LGA-24/LGA-25, but does
> not itself change current application behavior.
>
> **Authority:** First-release catalog, settings contract, and migration rules
> for user-configurable analytical cards. This document does not change current
> application behavior.

## Goal and boundaries

The first release should let a signed-in viewer tailor the two cards that
already contain product thresholds or filtering expectations:

- **Top Champions**: which champion aggregates qualify for display;
- **Recent Performance**: how much a recent value must differ from the overall
  baseline before the UI labels it improving or declining.

The recommendation deliberately keeps the profile's ranked-solo/duo context
and five-card layout stable. It does not add a dashboard builder, persist a
player's data twice, change a Riot ingestion job, or turn a visual color cue
into an analytical verdict.

Settings belong to the **viewing authenticated user**, not to the player being
viewed. The same preference therefore applies to the user's own profile and to
each tracked-player profile that the user is already authorized to see. It is
not shared with other users and must contain no PUUID, Riot ID, match data, or
secret.

## Current inventory

| Surface | Current behavior and dependency | First-release decision | Rationale |
| --- | --- | --- | --- |
| **Top Champions** | Both profile routes request `GET /matches/player/{puuid}/champion-stats?queue=420&limit=20`. The service groups all matching participants by champion, orders by games played, and the UI displays the first five. | **Configurable** | The landing page explicitly calls out win-rate, KDA, games-played, and role filters for this card. |
| **Recent Performance** | The card requests the latest 10 ranked-solo/duo matches and all stored ranked-solo/duo matches. A win-rate change must exceed 5 percentage points; every other metric must differ by more than 5% of its overall value. | **Configurable** | The threshold is hard-coded and the landing page identifies performance trends as the primary configurable-card use case. |
| **Role Performance** | `GET /matches/player/{puuid}/lane-stats?queue=420` groups recognized positions and orders them by games played. Win-rate and KDA color bands are display-only. | Not configurable in v1 | A role selector on this card would hide the comparison it is meant to show. The Top Champions role filter gives a useful, non-duplicated role choice. |
| **Player summary** | A `PlayerCard` combines identity, rank, refresh/tracking controls, and unfiltered summary statistics. | Not configurable in v1 | It is a profile summary and action surface, not a filtered analytical result. |
| **Playstyle Analysis summary cards** | The page renders the result of its existing analysis model, including summary metrics, main role/champion, and tags. | Deferred to LGA-33 | Its model, calculations, terminology, and first-release scope require the separate Player Analysis decision. |
| **Matchmaking Analysis result** | The result explains one explicitly requested matchmaking analysis and its inputs. | Not configurable in v1 | Its inputs belong to the analysis invocation and require a separate methodology decision. |
| **Match History** | This is a chronological exploration component rather than a configured result card. | Deferred to LGA-29 | Expanding/filtering match history has its own data-contract and UX decision. |

The current profile routes intentionally use the same three profile-stat cards
for the owner's profile and a tracked player. The configurable cards therefore
need one viewer-scoped contract, not route-specific or player-specific copies.

## Proposed catalog

The proposed stable identifiers are namespaced by the feature, not by a page
title. A card title may change without changing its stored identifier.

| Card ID | Version | Mutable settings | Fixed v1 behavior |
| --- | --- | --- | --- |
| `profile.top-champions` | `1` | minimum games, win rate, KDA, included roles | Ranked solo/duo (`420`), five displayed rows, games-played descending order |
| `profile.recent-performance` | `1` | recent sample size, win-rate trend tolerance, relative-metric trend tolerance | Ranked solo/duo (`420`), all matching matches for the overall baseline, current displayed metrics |

The catalog is an allowlist. A client must never invent an ID, setting name,
or version and rely on the server to accept it.

## Normalized version 1 contract

The following TypeScript-like form specifies the normalized data returned to a
client after server-side validation. Persistence may store only the mutable
fields, but reads always merge them with these defaults before the card uses
them.

```ts
type CardId = "profile.top-champions" | "profile.recent-performance";
type Role = "TOP" | "JUNGLE" | "MIDDLE" | "BOTTOM" | "UTILITY";

interface CardPreferenceV1<TCardId extends CardId, TSettings> {
  cardId: TCardId;
  version: 1;
  settings: TSettings;
}

interface TopChampionsSettingsV1 {
  queueId: 420;
  minimumGames: number; // integer, 1 through 999; default 1
  minimumWinRate: number; // percent, 0 through 100; default 0
  minimumKda: number; // 0 through 50 in 0.1 increments; default 0
  includedRoles: Role[]; // unique canonical values; [] means all roles
  displayLimit: 5; // exactly five visible rows; not configurable in LGA-23
}

interface RecentPerformanceSettingsV1 {
  queueId: 420;
  recentMatchCount: number; // integer, 5 through 50; default 10
  winRateTrendDelta: number; // fraction, 0.01 through 0.25; default 0.05
  relativeMetricTrendDelta: number; // fraction, 0.01 through 0.25; default 0.05
}
```

`winRateTrendDelta` is an absolute win-rate fraction: `0.05` means five
percentage points. `relativeMetricTrendDelta` is a fraction of the overall
metric: `0.05` means five percent of the overall value. Keeping them separate
preserves the two distinct current calculations while still allowing a simple
single “5% trend tolerance” control in the first UI. An advanced UI must show
their different meanings before exposing them independently.

The approved bounds prevent accidental unbounded queries and unusable inputs
while retaining the current defaults. `displayLimit` is intentionally fixed at
five simultaneously visible rows and is not a user setting in LGA-23. The
complete eligible result remains available to a future pagination contract;
LGA-46 owns pagination through that result and is not part of this ticket.

## Calculation and filtering rules

### Top Champions

1. Filter participant rows by the fixed queue `420` and, when
   `includedRoles` is non-empty, by the stored canonical `team_position`.
   Unknown or missing positions do not match an explicit role selection.
2. Group the remaining rows by champion and calculate games, wins, losses,
   win rate, and KDA from that selected population.
3. Apply `minimumGames`, `minimumWinRate`, and `minimumKda` to the aggregate
   result, not to individual matches.
4. Order eligible champions by games played descending. Preserve a stable
   secondary order, such as canonical champion name, so equal game counts do
   not jump between requests.
5. Order the complete eligible result, keep a deterministic secondary order,
   and return the first five visible rows for the LGA-23 card. The normalized
   `displayLimit: 5` is fixed and not configurable. LGA-46 may paginate the
   remaining eligible champions without changing this filtering or ordering
   contract. The client explains when data exists but no aggregate meets the
   selected filters.

These settings affect server-side calculation. Applying the filters only after
the current `limit=20` response would incorrectly hide a qualifying champion
that is outside the unfiltered top 20 and would make a role filter semantically
wrong.

### Recent Performance

1. Use queue `420` for both comparison populations.
2. Calculate the recent aggregate from `recentMatchCount` most recent matching
   matches. Calculate the overall baseline from all matching matches, exactly
   as the card does today when its limit is omitted.
3. Classify win rate with the absolute `winRateTrendDelta`; classify KDA,
   kills, deaths, assists, CS, and vision with
   `relativeMetricTrendDelta`. Deaths remains lower-is-better.
4. If the overall baseline is empty, keep the existing insufficient-data
   state. If fewer than the selected recent-match count exist, use the matches
   that exist and disclose the actual sample size rather than treating missing
   rows as zeros.

Sample size affects server-side calculation. Trend tolerances are
presentation-only: they change the improving/stable/declining label and color,
not the returned aggregate values.

## Defaults and lifecycle behavior

A viewer with no saved preference receives the normalized defaults above. They
reproduce the current behavior exactly:

| Card | Current behavior preserved by default |
| --- | --- |
| Top Champions | Queue 420, all roles, no aggregate thresholds, and the first five champions ordered by games played. The visible result is unchanged even though filtering must evaluate the complete aggregate population. |
| Recent Performance | Queue 420, recent 10 matches against all matching matches, 0.05 absolute win-rate tolerance, and 0.05 relative tolerance for the remaining metrics. |

The initial persistence API should have an explicit read, validated upsert, and
per-card reset operation. A reset removes the stored override and immediately
returns the normalized defaults. A global reset must enumerate the affected
catalog entries before confirmation; it must not delete unrelated account
settings. This is post-MVP product development, so the versioned lifecycle
below is required rather than optional MVP hardening.

On read or write, the server must validate the card ID, version, field types,
numeric bounds, unique roles, and allowed role values. The client repeats this
validation for immediate feedback, but client validation is not an authority.

| Situation | Required behavior |
| --- | --- |
| Unknown card ID or future version | Do not apply it. Preserve the stored record for a compatible future server when safe, and fall back to the current card's defaults with an observable warning. |
| Unknown or removed setting | Ignore only that field after recording a structured migration/log record; retain all still-valid settings. This does not require a new large audit subsystem. |
| Renamed card or setting | Keep a server-side versioned migration map. Reads migrate before normalization; writes persist only the new canonical name. |
| Added optional setting | Supply its documented default during normalization, then persist it only when the user changes it. |
| Invalid, corrupt, or out-of-range value | Reject an update atomically. On a legacy read, use defaults for the invalid field and surface a non-sensitive recovery message with Reset available. |
| Card removed from the product | Hide it from the catalog, retain a reversible migration/export path for its preference, and never silently reinterpret it as another card. The reversible path does not require a user-facing export screen in LGA-23. |

## Proposed first-release UX

Each selected card receives a **Customize** action that opens a keyboard-
accessible dialog. The dialog states that settings apply wherever that card is
shown to the current viewer, including tracked-player profiles. It offers
**Apply**, **Cancel**, and a card-local **Reset to defaults** action.

### Top Champions controls

- Minimum games — numeric stepper, default `1`.
- Minimum win rate — percentage stepper, default `0%`.
- Minimum KDA — decimal stepper, default `0.0`.
- Roles — multi-select of the canonical `TOP`, `JUNGLE`, `MIDDLE`, `BOTTOM`,
  and `UTILITY` values; no selection means all roles.

The card keeps its current five-row layout. If filters remove every champion,
the empty state names the active filters and offers Reset; it does not claim
that the player has no match data.

### Recent Performance controls

- Recent sample — 5 through 50 matches, default `10`.
- Trend tolerance — an initial single control at 5%, which writes both
  normalized tolerance fields. The UI must explain that this produces two
  different calculations: `0.05` is five percentage points for win rate, but
  five percent of the overall value for the other metrics. A later advanced
  mode may expose the two distinct tolerances independently.

Queue selection, card placement, and card visibility are intentionally absent
from this release. They belong to the later dashboard/catalog work rather than
to a threshold contract.

## Follow-up implementation sequence

1. **Persistence contract (LGA-24):** add a viewer-owned, versioned preference
   boundary with strict server validation, migration tests, and no player-data
   duplication.
2. **Calculation/API support:** extend the champion and match-stat query
   contracts with validated settings. Add aggregate-filter, role, tie-order,
   sparse-sample, and authorization tests.
3. **Frontend controls (LGA-25):** add Zod schemas, preference-aware TanStack
   Query keys, accessible dialogs, loading/error/reset states, and visual
   regression coverage. Update the profile feature guide only if its behavior
   changes.
4. **Verification:** prove default equivalence with fixtures before and after
   migration; run the focused frontend/backend gates while implementing and
   the complete repository gate before a pull request.

The exact persistence table, endpoint shape, query-key details, and dialog
layout remain implementation choices for LGA-24 and LGA-25. They must preserve
the approved card IDs, viewer-global scope, strict server validation, default
equivalence, fixed five-row display, and calculation boundaries recorded here.

## Owner approval and compatibility record

The owner approved this contract on 2026-08-06. The approval is for exactly
these v1 cards: `profile.top-champions` and `profile.recent-performance`.
It confirms ranked Solo/Duo only (`queueId: 420`), viewer-global settings,
empty `includedRoles` meaning all roles, the approved bounds/defaults, fixed
five-row display, deterministic ordering, complete-population filtering, and
the versioned lifecycle rules above. All other inventoried cards remain outside
the first configurable-card release for their documented reasons.

The contract remains compatible with the planned follow-up tickets:

- **LGA-24:** persistence and API work can store viewer-owned, versioned
  mutable settings, validate them server-side, normalize defaults, and reset a
  card without duplicating player data.
- **LGA-25:** frontend controls can consume the normalized contract, use an
  accessible dialog, and expose one trend-tolerance control while preserving
  the distinct mathematical meanings of its two fields. Five visible rows
  remain fixed in this ticket.
- **LGA-26:** dashboard/catalog work can add placement, visibility, or other
  card composition concepts without changing these stable namespaced card IDs
  or reinterpreting their settings.
- **LGA-46:** pagination can operate on the complete deterministically ordered
  eligible Top Champions result after LGA-23 filters. It may expose rows beyond
  the first five without making the number of simultaneously visible rows a
  setting here.

LGA-23 remains a contract/design ticket. It authorizes no preference table,
endpoint, calculation change, UI control, or displayed-behavior change until
the follow-up implementation work is performed in its designated tickets.
