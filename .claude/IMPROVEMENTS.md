# Improvements

Out-of-scope problems noticed while working on something else. One bullet per
issue, newest last:

`- <YYYY-MM-DD> <path from repo root>: one or two sentences.`

Empty as of 2026-08-20 — the queue was worked through end to end. Everything
it held was either fixed (#134 through #137) or, in the case of the
playstyle-analysis package, decided against and recorded in that package's
own `CLAUDE.md` so it does not come back here.
- 2026-08-20 frontend/features/jobs/components/job-card-format.ts: exports `formatRelativeTime`, and so does `frontend/lib/core/relative-time.ts` — same name, different semantics (narrow "5m ago" with no null handling vs. long-form "5 minutes ago" that answers "Never" for null and falls back to an absolute date past a week). Both are imported across the app and an autocomplete pick of the wrong one type-checks whenever the argument is a plain string. Rename one to say which clock it is.
- 2026-08-21 frontend/lib/core/schemas.ts: the OpenAPI-to-zod field digest that found the rune-ID and smurf-boost-results gaps is still a scratchpad script, so drift can reappear silently. Making it a gate step needs both artifacts (FastAPI `app.openapi()` and `z.toJSONSchema` over every export) plus a checked-in expected file; the script and its literal/enum/alias handling are in the session scratchpad as `align.py`.
