# Improvements

Out-of-scope problems noticed while working on something else. One bullet per
issue, newest last:

`- <YYYY-MM-DD> <path from repo root>: one or two sentences.`

Empty as of 2026-08-20 — the queue was worked through end to end. Everything
it held was either fixed (#134 through #137) or, in the case of the
playstyle-analysis package, decided against and recorded in that package's
own `CLAUDE.md` so it does not come back here.
- 2026-08-20 backend/app/core/riot_api/credential_health.py: `_stored_database_key` uses `SELECT ... ORDER BY added_at DESC LIMIT 1 FOR UPDATE`. If a concurrent save deletes the row the LockRows node picked, the statement returns zero rows rather than the replacement, so that one sync writes `MISSING` over a freshly saved credential. Self-healing on the next request and it needs an exact race with the once-daily key save, but the window is real. Pre-existing in kind (the `is_active`-filtered query raced the same way via a re-checked qual).
