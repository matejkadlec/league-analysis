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
already contain product thresholds or filtering expectations. LGA-20 added a
third card to the same contract; see
[Catalog additions after v1](#catalog-additions-after-v1).

The two v1 cards are:

- **Top Champions**: which champion aggregates qualify for display;
- **Recent Performance**: how much a recent value must differ from the overall
  baseline before the UI labels it improving or declining.

The recommendation deliberately keeps Player Overview's ranked-solo/duo context
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
| **Top Champions** | The profile page requests `GET /api/v1/matches/player/{puuid}/champion-stats?queue=420` (no limit parameter). The service returns the complete matching champion aggregate ordered by games played with the champion name as the deterministic tie-breaker; the UI displays five rows per local page. | **Configurable** | The landing page explicitly calls out win-rate, KDA, and role filtering. Minimum games is an owner-approved aggregate threshold, not a claim about that landing-page copy. |
| **Recent Performance** | The card requests the latest 10 ranked-solo/duo matches and an overall ranked-solo/duo request without a limit; the service currently caps that overall fetch at 10,000 matches. A win-rate change must exceed 5 percentage points; every other metric must differ by more than 5% of its overall value. | **Configurable** | The threshold is hard-coded and the landing page identifies performance trends as the primary configurable-card use case. |
| **Role Performance** | `GET /api/v1/matches/player/{puuid}/lane-stats?queue=420` groups recognized positions and orders them by games played. Win-rate and KDA color bands are display-only. | Not configurable in v1 | A role selector on this card would hide the comparison it is meant to show. The Top Champions role filter gives a useful, non-duplicated role choice. |
| **Player summary** | A `PlayerCard` combines identity, rank, refresh/tracking controls, and unfiltered summary statistics. | Not configurable in v1 | It is a profile summary and action surface, not a filtered analytical result. |
| **Playstyle card** | The underlying analysis model is retained for a future reusable Player Overview card, but the old dedicated page is retired. | Deferred to LGA-33 | Its formulas, terminology, and first-release scope require the separate evidence-based Playstyle decision. |
| **Matchmaking Analysis result** | The result explains one explicitly requested matchmaking analysis and its inputs. | Not configurable in v1 | Its inputs belong to the analysis invocation and require a separate methodology decision. |
| **Match History** | This is a chronological exploration component rather than a configured result card. | Deferred to LGA-29 | Expanding/filtering match history has its own data-contract and UX decision. |

Player Overview intentionally uses the same three profile-stat cards for any
globally selected player. The configurable cards therefore need one
viewer-scoped contract, not route-specific or player-specific copies.

## Proposed catalog

The proposed stable identifiers are namespaced by the feature, not by a page
title. A card title may change without changing its stored identifier.

| Card ID | Version | Mutable settings | Fixed v1 behavior |
| --- | --- | --- | --- |
| `profile.top-champions` | `1` | minimum games, win rate, KDA, included roles | Ranked solo/duo (`420`), up to five eligible displayed rows with no padding, games-played descending order |
| `profile.recent-performance` | `1` | recent sample size, win-rate trend tolerance, relative-metric trend tolerance | Ranked solo/duo (`420`), current overall baseline including its 10,000-match fetch cap, current displayed metrics |

The catalog is an allowlist. A client must never invent an ID, setting name,
or version and rely on the server to accept it.

## Normalized version 1 contract

The following TypeScript-like form specifies the normalized data returned to a
client after server-side validation. Persistence may store only the mutable
fields, but reads always merge them with these defaults before the card uses
them.

```ts
type CardId =
  | "profile.top-champions"
  | "profile.recent-performance"
  | "profile.smurf-boost-detection";
type Role = "TOP" | "JUNGLE" | "MIDDLE" | "BOTTOM" | "UTILITY";

interface TopChampionsSettingsV1 {
  queueId: 420;
  minimumGames: number; // integer, 1 through 999; default 1
  minimumWinRate: number; // percent, 0 through 100; default 0
  minimumKda: number; // 0 through 50 in 0.1 increments; default 0
  includedRoles: Role[]; // unique canonical values; [] means all roles
  displayLimit: 5; // maximum five eligible rows; not configurable in LGA-23
}

interface RecentPerformanceSettingsV1 {
  queueId: 420;
  recentMatchCount: number; // integer, 5 through 50; default 10
  winRateTrendDelta: number; // fraction, 0.01 through 0.25; default 0.05
  relativeMetricTrendDelta: number; // fraction, 0.01 through 0.25; default 0.05
}

type CardSettingsById = {
  "profile.top-champions": TopChampionsSettingsV1;
  "profile.recent-performance": RecentPerformanceSettingsV1;
};

type CardPreferenceV1 = {
  [TCardId in CardId]: {
    cardId: TCardId;
    version: 1;
    settings: CardSettingsById[TCardId];
  }
}[CardId];
```

`CardPreferenceV1` is a discriminated union: a `cardId` selects exactly one
settings type, so a client cannot pair one card's ID with another card's
settings. The server must enforce the same mapping at runtime.

`winRateTrendDelta` is an absolute win-rate fraction: `0.05` means five
percentage points. `relativeMetricTrendDelta` is a fraction of the overall
metric: `0.05` means five percent of the overall value. Keeping them separate
preserves the two distinct current calculations while still allowing a simple
single “5% trend tolerance” control in the first UI. An advanced UI must show
their different meanings before exposing them independently.

The approved bounds prevent accidental unbounded queries and unusable inputs
while retaining the current defaults. `displayLimit` is intentionally fixed at
a maximum of five eligible rows and is not a user setting in LGA-23. The
complete eligible result remains available to a future pagination contract;
LGA-46 owns pagination through that result and is not part of this ticket.

## Calculation and filtering rules

### Top Champions

1. Filter participant rows by the fixed queue `420` and, when
   `includedRoles` is non-empty, by the stored canonical `team_position`.
   Unknown or missing positions do not match an explicit role selection.
2. Group the remaining rows by champion and calculate games, wins, losses,
   win rate, and KDA from that selected population. KDA uses the aggregate
   formula `(totalKills + totalAssists) / totalDeaths`; when total deaths are
   zero, use `totalKills + totalAssists` instead. Do not average per-match KDA
   values.
3. Keep an aggregate result only when games played, win rate, and KDA are each
   greater than or equal to their configured minimum. Apply `minimumGames`,
   `minimumWinRate`, and `minimumKda` to the aggregate result, not to
   individual matches. Equality at the default 0% and 0 KDA thresholds remains
   eligible, as does a one-game aggregate at the default minimum-games value.
4. Order eligible champions by games played descending. For equal game counts,
   use the canonical champion name in ascending lexicographic order as the
   secondary key. The backend already implements exactly this ordering for the
   unfiltered aggregate; the filtered calculation must keep it.
5. Order the complete eligible result and return up to five eligible rows for
   the LGA-23 card. The normalized `displayLimit: 5` is a fixed maximum and
   not configurable; the card never pads or fabricates rows when fewer
   champions qualify. LGA-46 may paginate the remaining eligible champions
   without changing this filtering or ordering contract. The client explains
   when data exists but no aggregate meets the selected filters.

Default equivalence covers the current filters, metrics, sample populations,
row capacity, and the already-implemented deterministic tie ordering.

These settings affect server-side calculation. Applying the filters only to a
truncated client-side page of the aggregate would incorrectly hide a
qualifying champion outside that page and would make a role filter
semantically wrong; filters must be applied to the complete aggregate
population before ordering and display.

### Recent Performance

1. Use queue `420` for both comparison populations.
2. Calculate the recent aggregate from `recentMatchCount` most recent matching
   matches. Calculate the overall baseline from matching matches within the
   current service behavior: an omitted limit fetches at most 10,000 matches.
   Preserving this cap is part of default equivalence; removing it requires an
   explicit behavior change in a later ticket. For both the recent and overall
   population, Recent Performance KDA uses aggregate participant totals:
   `(totalKills + totalAssists) / totalDeaths`; when total deaths are zero, use
   `totalKills + totalAssists`. For Recent Performance, do not average
   per-match KDA values.
3. Classify win rate with the absolute `winRateTrendDelta`; classify KDA,
   kills, deaths, assists, CS, and vision with
   `relativeMetricTrendDelta`. Every comparison uses strict bounds: it is
   improving or declining only when its directional difference strictly exceeds
   the configured tolerance; equality at the configured tolerance is stable.
   For win rate, compare the difference directly to
   `winRateTrendDelta`. For every relative metric, use
   `overallMetric * relativeMetricTrendDelta` as its tolerance. Deaths remains
   lower-is-better, so its improving and declining directions are inverted
   while the same strict boundary and stable equality rule applies.
4. If the overall baseline is empty, keep the existing insufficient-data
   state. If fewer than the selected recent-match count exist, use the matches
   that exist and disclose the actual sample size rather than treating missing
   rows as zeros. This is an intentional LGA-25 display-label change: the
   current card labels that comparison `Recent 10 games` even when fewer
   matching matches exist. The future label must identify the actual sample
   size rather than claiming a full ten-match sample.

Sample size affects server-side calculation. Trend tolerances are
presentation-only: they change the improving/stable/declining label and color,
not the returned aggregate values.

## Defaults and lifecycle behavior

A viewer with no saved preference receives the normalized defaults above. They
reproduce the current filters, metrics, sample populations, row capacity, and
the deterministic tie ordering the backend already implements. The only
documented follow-up display difference is, for a sparse
recent population, an actual-sample-size label instead of `Recent 10 games`:

| Card | Current behavior preserved by default |
| --- | --- |
| Top Champions | Queue 420, all roles, no aggregate thresholds, and up to five eligible champions ordered by games played with a deterministic tie-breaker. The visible capacity is unchanged even though filtering must evaluate the complete aggregate population. |
| Recent Performance | Queue 420, recent 10 matches against the current overall matching population capped at 10,000, 0.05 absolute win-rate tolerance, and 0.05 relative tolerance for the remaining metrics. For sparse results, LGA-25 intentionally replaces the current `Recent 10 games` copy with actual-sample-size disclosure. |

The initial persistence API should have an explicit read, validated upsert, and
per-card reset operation. A reset removes the stored override and immediately
returns the normalized defaults. A global reset must enumerate the affected
catalog entries before confirmation; it must not delete unrelated account
settings. This is post-MVP product development, so the versioned lifecycle
below is required rather than optional MVP hardening.

Preference storage is version-coexistent: the durable key includes the viewer,
canonical card ID, and stored version. A known future-version record therefore
remains beside any current v1 row. A v1 upsert or per-card reset may create,
replace, or remove only the current v1 row; it must preserve future-version
rows. If the storage implementation cannot coexist versions, reject the
mutation with a version-conflict response rather than overwriting or deleting
the future record.

On a legacy read, the server must validate the record before applying or
normalizing it. On every write, it must validate the card ID, version, field
types, numeric bounds, unique roles, and allowed role values before mutating
storage. Current API writes accept only canonical camel-case field names and
the JSON integer literal `version: 1`; snake-case names, booleans, floats, and
strings are not compatible aliases. The client repeats this validation for
immediate feedback, but client validation is not an authority.

| Situation | Required behavior |
| --- | --- |
| Unknown card ID on a legacy read | Do not apply or normalize it. Preserve the raw record for a compatible future server when safe, omit it from normalized output, and emit an observable non-sensitive warning or structured migration record. Never substitute another card's defaults. |
| Known card ID with a future version on a legacy read, with no supported row | Do not apply the future record. Preserve it for a compatible future server when safe, fall back to that known card's current defaults, and emit an observable warning. |
| Known card ID with both a current v1 row and a future-version row | Normalize exactly one entry per card. The current v1 row takes precedence; inspect the future row only for preservation and observability. |
| Write with an unknown card ID or unsupported version | Reject the entire update atomically before persistence. Writes never preserve submitted raw records; only compatible future servers may create their own supported records. |
| Legacy record with an unknown or removed setting | On read, ignore only that field after recording a structured migration/log record; retain all still-valid settings. This does not require a new large audit subsystem. |
| Write with an unknown or removed setting | Reject the entire update atomically. Writes accept only the canonical settings for the known card/version, so clients cannot believe an ignored preference was saved. |
| Renamed card or setting | Keep a server-side versioned migration map. Reads migrate before normalization; writes persist only the new canonical name. |
| Added optional setting | Supply its documented default during normalization, then persist it only when the user changes it. |
| Invalid, corrupt, or out-of-range value | Reject an update atomically. On a legacy read, use defaults for the invalid field and surface a non-sensitive recovery message with Reset available. |
| Card removed from the product | Hide it from the catalog, retain a reversible migration/export path for its preference, and never silently reinterpret it as another card. The reversible path does not require a user-facing export screen in LGA-23. |

Each normalized read response includes `requiresRecovery`. It is `true` only
when a stored current-version preference contained a malformed, removed, or
out-of-range field and the server substituted a default. The flag exposes no
stored value or field name; clients use it to show the non-sensitive recovery
message and offer the existing card-local Reset action.

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

The card keeps its current five-row capacity and renders up to five eligible
champions. It never pads or fabricates rows when fewer qualify. If filters
remove every champion, the empty state names the active filters and offers
Reset; it does not claim that the player has no match data.

### Recent Performance controls

- Recent sample — 5 through 50 matches, default `10`.
- Trend tolerance — an initial single control at 5%, which writes both
  normalized tolerance fields. The UI must explain that this produces two
  different calculations: `0.05` is five percentage points for win rate, but
  five percent of the overall value for the other metrics. When the normalized
  fields are equal, the control displays their shared value. When they differ
  because of an advanced write or legacy data, it displays a mixed/custom state
  instead of choosing one value. Changing another setting preserves both
  underlying tolerances; explicitly changing this control writes both fields to
  the newly selected value. A later advanced mode may expose the two distinct
  tolerances independently.

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
equivalence, fixed five-row capacity, and calculation boundaries recorded here.

## LGA-24 persistence and API boundary

LGA-24 implements the approved persistence boundary without changing a card's
current calculation or rendered output. Alembic revision `20260806_0002` adds
`auth.user_card_preferences`, keyed by `(user_id, card_id, version)`. It stores
only validated mutable settings; the API always adds the fixed queue and
display-limit fields while normalizing an effective v1 response.

The authenticated settings API exposes only the current viewer's records:

| Operation | Route | Behavior |
| --- | --- | --- |
| Read effective catalog | `GET /api/v1/settings/card-preferences` | Returns every card in the current catalog, including defaults where a v1 row is absent. |
| Replace one override | `PUT /api/v1/settings/card-preferences/{cardId}` | Requires `version: 1` and the complete mutable schema for that exact catalog card; PostgreSQL upsert makes concurrent replacements atomic. |
| Reset one card | `DELETE /api/v1/settings/card-preferences/{cardId}` | Deletes only the viewer's v1 row for that card, then returns normalized defaults. |
| Reset catalog | `POST /api/v1/settings/card-preferences/reset` | Requires an explicit `cardIds` enumeration of the current catalog — **every** card, exactly once — then removes only its v1 rows. A stale enumeration is a `422`, which is the point: the route refuses to guess what a caller meant to reset. |

The routes never accept a user ID, player ID, or arbitrary card identifier, so
the authenticated dependency provides the only ownership scope. Writes reject
unknown fields, unsupported versions, invalid ranges, duplicate roles, and
incomplete mutable payloads before persistence. Reads preserve unsupported
future-version rows, ignore only malformed legacy fields, and emit a
non-sensitive structured warning rather than interpreting them as another
card's setting.

## Owner approval and compatibility record

The owner approved this contract on 2026-08-06. The approval is for exactly
these v1 cards: `profile.top-champions` and `profile.recent-performance`.
It confirms ranked Solo/Duo only (`queueId: 420`), viewer-global settings,
empty `includedRoles` meaning all roles, the approved bounds/defaults, fixed
five-row capacity with no padding, deterministic ordering, complete-population
filtering, the current 10,000-match overall baseline cap, and the versioned
lifecycle rules above. All other inventoried cards remain outside
the first configurable-card release for their documented reasons.

### Catalog additions after v1

LGA-20 added `profile.smurf-boost-detection` — fifteen model thresholds and the
same fixed `queueId: 420` — to `CardId`, to the reset enumeration, and to the
effective catalog. It follows every rule above: viewer-global, versioned,
server-validated bounds, `DELETE` resets one card.

**This addition is not covered by the 2026-08-06 approval and is pending owner
sign-off.** Two things change for a client the moment it merges: the catalog
response carries three entries rather than two, and the catalog reset requires
all three `cardIds`. A client still sending the two-card enumeration receives a
`422`. Nothing else in this contract changes.

The contract remains compatible with the planned follow-up tickets:

- **LGA-24:** persistence and API work can store viewer-owned, versioned
  mutable settings, validate them server-side, normalize defaults, and reset a
  card without duplicating player data.
- **LGA-25:** frontend controls can consume the normalized contract, use an
  accessible dialog, and expose one trend-tolerance control while preserving
  the distinct mathematical meanings of its two fields. The five-row capacity
  remains fixed in this ticket.
- **LGA-26:** dashboard/catalog work can add placement, visibility, or other
  card composition concepts without changing these stable namespaced card IDs
  or reinterpreting their settings.
- **LGA-46:** pagination operates on the complete deterministically ordered
  eligible Top Champions result after LGA-23 filters. It exposes rows beyond
  the first five without making the five-row capacity a setting here.

LGA-23 remains a contract/design ticket. It authorizes no preference table,
endpoint, calculation change, UI control, or displayed-behavior change until
the follow-up implementation work is performed in its designated tickets.
