# Features (`features/`)

> **Scope:** Frontend feature invariants and conventions under
> `frontend/features/`.
>
> **Maintenance:** Update when a feature invariant or convention changes. The
> feature inventory and per-feature structure live in the code
> (`features/<name>/`: `components/`, `index.ts`, optional `types.ts` and
> `utils/`).

Inherits repository-wide rules from [`../../AGENTS.md`](../../AGENTS.md) and
frontend rules from [`../AGENTS.md`](../AGENTS.md).

Domain-specific UI components. Each feature is self-contained and exports its
public API via `index.ts`.

## Rules

- `"use client"` for interactivity; TypeScript interfaces for props; handle
  loading/error/success states; use shadcn/ui from `@/components/ui/`;
  kebab-case files, PascalCase components.
- Service reachability errors may suggest checking the League Analysis backend,
  but must not claim that the user's internet connection is unavailable.
- Transient operation failures belong to the interaction that produced them:
  clear them when the component unmounts, when a replacement attempt starts,
  and after success. Persisted history remains available separately and must
  not rehydrate an old failure into a current-session alert.
- Ordinary player-centric pages consume `usePlayerContext()` and keep the
  explicit URL PUUID authoritative for the current tab. Matchmaking Analysis
  uses the global current player only as its initial reference/default, then
  owns a local analyzed-player PUUID. Its shared one-field selector may
  discover a canonical player but must not change global context or tracking.
- Every player-derived TanStack Query key must include the exact PUUID. After
  explicit update completion, refetch only matching active keys and show the
  approved completion message only after every affected refetch succeeds.
- The shared `["player", puuid]` query stores a validated raw `Player` through
  `playerQueryOptions()`. Never cache an API-result envelope or attach a query
  function with a different return shape to that key.
- Match History queue labels, filter order, query IDs, and fixed label widths
  live in `matches/queue-catalog.ts`. Keep All Queues unrestricted and
  exclusive, use a normal selection for one queue and Shift selection for a
  non-empty queue union, reset numbered pagination on any queue/search/page-size
  change, and preserve unknown IDs as `Queue N` instead of mapping them to a
  supported mode. Champion or player search is server-backed across every
  participant in the selected queue union and must run before pagination.
  Debounce its normalized value before it enters the TanStack Query key so one
  typing burst produces only the final detailed-history request.
  Ranked Solo/Duo and 25 matches are the defaults; queue selection and page
  size persist only through consent-gated optional browser storage.
- Match History objective order, accessible labels, counts, and dedicated
  silhouettes and tuned visual sizes live in
  `matches/components/objective-icons.tsx`. Preserve the shared semantic
  mapping for every consumer. Riot-derived match-history art for Turret,
  Inhibitor, Dragon, Voidgrub, Rift Herald, and Baron lives in
  `matches/components/objective-icon-assets.ts`; do not replace those
  silhouettes with generic icon-library approximations. The Voidgrub uses the
  bottom cell of Riot's `right_icons_grub.png` sprite, normalized to the same
  source palette, team-color filter, and perceived size as the other icons.
- The Match Fetcher Jobs card has no per-queue checkboxes. Backend product
  support determines its complete queue set; the UI retains only job-level
  status, schedule, triggering, testing, pause/stop, and history controls.
- The Tracked Players dialog presents the player rows directly without
  a second title, count, search field, or expand/collapse control. Show up to
  five rows before enabling vertical scrolling.
- The Player Card tracking-status toggle keeps a fixed 72x24 border box in
  Tracked, Untrack, Untracked, and Track states. Keep its 14px icon, 10px label,
  and 4px icon/label gap so the longest state remains unclipped without layout
  movement.
- Use `profile_synced_at`, `league_synced_at`, or `match_synced_at` according to
  the card's actual source. Multi-source identity cards use the oldest complete
  required timestamp; never use generic `updated_at` as data freshness.
- Matchmaking Analysis must seed its active UI from the fast start response,
  rehydrate and poll the exact persisted run, treat rate-limit waits as active,
  cancel by `created_at`, and invalidate result/history data on completion. Keep
  provider throttling internal: the active card always presents one total ETA,
  while its percentage/bar interpolate between authoritative player milestones.
  Persisted Matchmaking Analysis failures with
  `error_code=RIOT_API_KEY_INVALID` must activate the shared API-key header
  refresh signal; accepting, polling, or completing a run must not mark the key
  valid. Only backend-observed direct Riot responses own that decision.
- Smurf & Boost Detection takes every string the specification fixes — bands,
  family titles, confidence labels, note readings, disclaimer — from
  `smurf-boost/smurf-boost-vocabulary.ts`; never write one of those inline.
  Present one band per family and never a combined verdict, a percentage, a
  0-100 score, or a probability. Keep unavailable signals visible with their
  reason, render an unknown note identifier as itself, and keep the disclaimer
  always expanded. The forbidden wording and the band vocabulary are fixed by
  `smurf-boost/smurf-boost-vocabulary.ts`, which the backend's own
  `smurf_boost_detection/schemas.py` is checked against.
  Read the persisted run lifecycle before rendering: the backend answers a
  failed run and a run already in flight with HTTP 200, so neither is a result,
  while a run in flight under *different* thresholds is a `409`. Never report a
  signal as below its threshold when its value is not: four of the eight
  combine the threshold with a second condition that can fail on its own.
  Threshold ranges are duplicated in `smurf-boost/smurf-boost-settings.ts` and
  guarded against the backend by `tests/smurf-boost-settings.test.ts`; strip the
  card's fixed settings before a write, and leave a server rejection to the
  shared error normalization rather than parsing its raw body.
- Smurf & Boost Detection renders every measurement twice: stacked blocks below
  the `sm` breakpoint and the table from `sm` up. Both must render from the same
  `SignalOutcome`, `formatValue`, and `noteLabel`, so the two can never disagree
  about what a value means. The stacked list carries `role="list"`, because the
  Tailwind reset drops the marker and WebKit drops the list role with it. Query
  either layout by `data-testid="smurf-boost-measurements-stacked-<family>"`
  rather than by breakpoint class.
- `main` in `app/layout.tsx` carries `min-w-0`. A flex item defaults to
  `min-width: auto` and then refuses to shrink below its content, which makes
  every `overflow-x-auto` beneath it inert and lets one wide child stretch the
  whole document sideways. Keep that class. It bounds the shell, not the page:
  content with no scroll container of its own still overflows visibly, so assert
  the document width at a phone viewport rather than trusting either.
