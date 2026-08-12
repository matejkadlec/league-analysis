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
- Ordinary player-centric pages consume `usePlayerContext()` and keep the
  explicit URL PUUID authoritative for the current tab. Matchmaking Analysis
  remains a deliberate local-target exception.
- Every player-derived TanStack Query key must include the exact PUUID. After
  explicit update completion, refetch only matching active keys and show the
  approved completion message only after every affected refetch succeeds.
- The shared `["player", puuid]` query stores a validated raw `Player` through
  `playerQueryOptions()`. Never cache an API-result envelope or attach a query
  function with a different return shape to that key.
- Match History queue labels, filter order, query IDs, and fixed label widths
  live in `matches/queue-catalog.ts`. Keep All Queues unrestricted, reset local
  pagination on a filter change, and preserve unknown IDs as `Queue N` instead
  of mapping them to a supported mode.
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
