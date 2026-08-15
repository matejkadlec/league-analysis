# Features (features/)

Each feature is self-contained: `components/`, `index.ts` public API, optional
`types.ts`/`utils/`. shadcn/ui primitives come from `@/components/ui/`.

- Player-derived query keys must include the exact PUUID; after an explicit
  update, refetch only matching active keys and show the completion message
  only after every refetch succeeds. The shared `["player", puuid]` key stores
  a validated raw `Player` via `playerQueryOptions()` — never an API-result
  envelope.
- The explicit URL PUUID is authoritative for the current tab. Matchmaking
  Analysis uses the global current player only as its initial default, then
  owns a local analyzed-player PUUID that never mutates global context or
  tracking.
- Transient failures belong to the interaction that produced them — clear on
  unmount, on a replacement attempt, and after success; persisted history must
  not rehydrate an old failure into a current-session alert. Reachability
  errors may suggest checking the backend, never that the user's internet is
  down.
- Freshness: use `profile_synced_at` / `league_synced_at` / `match_synced_at`
  per the card's actual source (multi-source identity cards: the oldest
  complete required timestamp); never generic `updated_at`.
- Match History queue labels, filter order, and fixed label widths live in
  `matches/queue-catalog.ts` (All Queues unrestricted, local pagination resets
  on filter change, unknown IDs render as `Queue N`). Objective icons live in
  `matches/components/objective-icons.tsx` + `objective-icon-assets.ts` (Riot
  art — never replace with icon-library approximations).
- Smurf & Boost Detection: every specification-fixed string (bands, family
  titles, confidence labels, note readings, disclaimer) comes from
  `smurf-boost/smurf-boost-vocabulary.ts` — never inline one. One band per
  family; never a combined verdict, percentage, 0-100 score, or probability.
  A failed run and an in-flight run both answer HTTP 200 — read the persisted
  lifecycle before rendering; a run in flight under different thresholds is a
  409.
- Matchmaking Analysis: seed the active UI from the fast start response,
  rehydrate and poll the exact persisted run, treat rate-limit waits as
  active, cancel by `created_at`, one total ETA on the active card. Persisted
  failures with `error_code=RIOT_API_KEY_INVALID` must activate the shared
  header refresh signal; only backend-observed direct Riot responses decide
  key validity.
- The Player Card tracking toggle keeps a fixed 72x24 border box across all
  states (14px icon, 10px label, 4px gap). The Tracked Players dialog shows
  player rows directly — no second title, count, search, or expand control;
  up to five rows before scrolling.
