# Improvements

Out-of-scope problems noticed while working on something else. One bullet per
issue, newest last:

`- <YYYY-MM-DD> <path from repo root>: one or two sentences.`

- 2026-08-22 frontend/features/matchmaking/components/matchmaking-analysis-history.tsx:123:
  the figure labels are `text-[0.6875rem]` (11px), the same 11px that was just
  raised to 14px on the Rank Manipulation result card. Left alone because
  Matchmaking Analysis has had no user QA on its typography and the change is
  visible; the size floor in `tests/rank-manipulation-surface.test.ts` now
  catches arbitrary sizes under 14px but only scans the Rank Manipulation
  surface, so nothing will flag this one.

- 2026-08-24 backend/app/features/jobs/queue_config.py: a 19-line module whose
  whole job is popping the obsolete `enabled_queue_ids` key that the initial
  schema seed (20260803_0001, line ~746) still writes. Deleting the module
  passes the deletion test only if a data migration also strips the key from
  existing prod rows — verified present on prod row 1 via the mirror
  (2026-08-24). A decision about historical rows, not a refactor.

- 2026-08-24 backend/tests/test_unhandled_error_response.py: fails on a dev
  machine whose root `.env` sets `DEBUG=true` — Starlette's debug error page
  (a plaintext traceback) replaces the JSON `SERVICE_ERROR_DETAIL` body the
  test pins. Passes with `DEBUG=false` and in CI. The test could pin the
  setting itself (monkeypatch the settings dependency) instead of inheriting
  whatever the machine's `.env` says.

What follows is the handful of findings worth not
rediscovering — two that were wrong, and one that was right about the symptom
and wrong about the cause. Everything else logged here has been fixed and its
detail lives in the commit that fixed it.

## Findings that did not survive measurement

**Toast contrast (2026-08-22, withdrawn).** Sonner's `richColors` description
is `#00091a` on a pale tint — around 19:1. Axe was measuring the toast
mid-fade-in at `opacity: 0.0257`, which fails any threshold.
`e2e/smurf-boost-detection.spec.ts` now waits for the toast to reach
`opacity: 1` and scans it instead of excluding the toaster. Worth remembering
before trusting the next `color-contrast` finding against an animated element.

**The quick-nav panel's "longest list" (2026-08-22, cause was wrong).** The
entry claimed `h-[242px]` was sized for the longest nav list and merely looked
empty on shorter ones. Measured: the longest list any page declares is four
entries, which render about 160px — so the box was ~40% empty on *every* page,
and 242px was an arbitrary rail height rather than a fit to anything. The fix
that followed from the corrected cause was different from the one the entry
proposed: the fixed height stayed on the collapse tab, which must not move as
sections mount, and only the panel became content-sized. Three entries now
measure 132px, asserted in `e2e/smurf-boost-detection.spec.ts`.

**The orphaned match write (2026-08-16, not a defect).** `EUN1_3990695865` was
written with no `jobs.job_executions` row covering the instant, but 2,776 of
production's 3,778 matches sit outside every execution window, and
`MatchmakingAnalysisService` calls `upsert_match` on the request path. Match
writes outside a recorded execution are the normal case here.

## Standing lesson

Measure before believing an entry in this file, including one you wrote
yourself. Two of the three above were written confidently and were wrong about
either the finding or its cause, and in both cases a single measurement — the
computed opacity, the rendered height — was enough to tell.

- 2026-08-24 frontend/app/rank-manipulation/page.tsx: `key={analyzedPlayer?.puuid ?? "no-player"}` on the detection card is load-bearing (the player search only keeps the chosen name because the card remounts) but deleting it passes both suites. Only reachable for an account with no current player, which no harness sets up. Same for `initialSearchValue` on frontend/app/matchmaking-analysis/page.tsx, which has no page-level test at all.

- 2026-08-24 frontend/e2e/support/smurf-boost-harness.ts: the harness 404s `/players/{puuid}/league` and the three `/matches/player/{puuid}/*-stats` routes, which the first detection spec hits because it starts on `/player-overview` before navigating. Each 404 raises a global "Could not load this data" toast that can sit beside whatever a later step asserts — the same class of flake that broke CI on PR #216 via the unmocked `/settings/service-status` poll. Mock the four, or route the spec so it never loads that page.
- 2026-08-24 backend/app/features/players/service.py: `get_player_by_puuid` runs `_match_counts` at line 142 only to log the two numbers, then returns `_one_player`, which runs the same two COUNT queries again. Four count queries per player fetch where two would do; delete the first call and log the counts off the response.
