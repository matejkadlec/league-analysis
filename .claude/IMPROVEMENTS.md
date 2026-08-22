# Improvements

Out-of-scope problems noticed while working on something else. One bullet per
issue, newest last:

`- <YYYY-MM-DD> <path from repo root>: one or two sentences.`

The queue is empty. What follows is the handful of findings worth not
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
