# Improvements

Out-of-scope problems noticed while working on something else. One bullet per
issue, newest last:

`- <YYYY-MM-DD> <path from repo root>: one or two sentences.`

## Open

Nothing open.

## Findings that did not survive measurement

The findings worth not rediscovering — the ones that were wrong, or right
about the symptom and wrong about the cause. Everything else logged here has
been fixed and its detail lives in the commit that fixed it.

**Toast contrast (2026-08-22, withdrawn).** Sonner's `richColors` description
is `#00091a` on a pale tint — around 19:1. Axe was measuring the toast
mid-fade-in at `opacity: 0.0257`, which fails any threshold.
`frontend/e2e/smurf-boost-detection.spec.ts` now waits for the toast to reach
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
measure 132px, asserted in `frontend/e2e/smurf-boost-detection.spec.ts`.

**The `key` on the detection card (2026-08-24, cause was wrong).** The entry
claimed `key={analyzedPlayer?.puuid ?? "no-player"}` was load-bearing because
"the player search only keeps the chosen name because the card remounts".
Measured with a mount probe: the prop *is* load-bearing — without it the card
keeps the same React instance across a player switch — but not for that reason.
Deleting the key left the search box seeding correctly and every existing test
green. What it actually protects is the card's own state, and the visible
casualty is the fetch report from #217: un-keyed, "The last fetch added 12."
follows you onto the next player, who nobody fetched anything for. That is what
`frontend/e2e/smurf-boost-detection.spec.ts` now pins.

**"Neither prop is covered" (2026-08-24, half wrong).** The same entry paired
that key with `initialSearchValue` on the same page. Removing the prop failed
the pre-existing "compares a player the account has never tracked" e2e
immediately — it had been covered all along. Only the matchmaking page's copy
was genuinely untested, and it now has `frontend/tests/matchmaking-analysis-page.test.tsx`.

**"Four unmocked routes" (2026-08-24, one already fixed).** The harness entry
named `/players/{puuid}/league` and three `/matches/player/{puuid}/*-stats`
routes. Logging the catch-all and running the suite found three: `/stats` had
been mocked by #217 before the entry was read. Counting from the source rather
than from a run would have added a fourth mock nobody needed.

**The logout docstring (2026-08-25, already fixed).** The entry described a
~1000-character OpenAPI `description` and proposed a `\f` truncation marker.
Read before writing any code: #223's three-line prose ceiling had already cut it
to a summary line plus the caller-facing contract, which is what the entry
wanted, and `\f` would have hidden nothing worth hiding. Second time this file
has logged work that a merged PR had already done — see "Four unmocked routes"
above.

**The orphaned match write (2026-08-16, not a defect).** `EUN1_3990695865` was
written with no `jobs.job_executions` row covering the instant, but 2,776 of
production's 3,778 matches sit outside every execution window, and
`MatchmakingAnalysisService` calls `upsert_match` on the request path. Match
writes outside a recorded execution are the normal case here.

**The body-verb query bag (2026-08-28, undercounted).** The entry named two
call sites passing a query past a body; there were three, and the third
(`/jobs/{id}/test`) sent `suspend_regular`, a name no test in either language
mentioned. Reaching the bag turned out to be one balanced-bracket scan, not the
parser rewrite the entry implied -- but two of the three sites then had to be
rewritten as plain object literals before their names could be read at all, so
the extractor was the smaller half of the work.

## Standing lesson

Measure before believing an entry in this file, including one you wrote
yourself. Six of the seven above were written confidently and were wrong about
either the finding, its cause, its size, or whether it was still true, and in
every case one measurement — the computed opacity, the rendered height, a mount
probe, a logged catch-all, one deleted prop, one read of the file itself — was
enough to tell. The 2026-08-24 batch is the sharpest example: three entries,
and the fix that followed matched what the entry asked for in exactly one of
them.

The corollary is about tests, not entries. A fix that makes its own check pass
is not yet evidence: the `DEBUG` pin in `backend/tests/test_unhandled_error_response.py`
passed alone and failed in the suite, because Starlette reads that flag when
the middleware stack is built and an earlier test had already built it. Run the
whole suite before believing a fix, and mutate the line to watch the test
fail.
