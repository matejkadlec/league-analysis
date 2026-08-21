# Pitfalls

Known ways this codebase breaks at runtime while every gate passes — ruff,
pyright, ESLint, tsc, and the test suite all go green and the bug still ships.

Rules that a type, a test, or a hook can enforce do **not** belong here. Those
go into the enforcing mechanism, and the entry gets deleted. This file is only
for what nothing can catch automatically yet.

## Adding an entry

When a bug turns out to be a repeatable trap rather than a one-off mistake,
append a bullet below: **symptom first**, then root cause, then what to check.
Name any existing partial guard so the next reader knows what is already
covered. Before adding one, ask whether a test or a hook could catch it
instead — the gate runs on every PR, this list is only read when someone runs
the `pitfall-check` agent.

## Entries

- **`MissingGreenlet` at job completion.** Reading `job_execution` or
  `job_config` attributes off the ORM instance during completion, or after the
  job's session closes, raises `MissingGreenlet`. A rollback expires the
  instance, and reloading it outside the async greenlet fails. Use the cached
  id/status/timestamp scalars captured while the session was open. Existing
  per-function guards: `test_get_job_logs_never_touches_the_orm_instance`,
  `test_failure_from_job_never_touches_the_execution_instance`, and
  `tests/test_job_loops_survive_a_rollback.py` for the two writer loops (it
  expires rows with SQLAlchemy's own `instance_state`, so it fails the way
  production does) — new code paths are not covered by any of them. The same
  trap bit the tracked-player loops: `handle_player_error` rolls back to skip
  one player, and a row loaded before that rollback raises on its next
  attribute read.

- **A wide child stretches the whole page sideways.** A flex item defaults to
  `min-width: auto`, which makes every `overflow-x-auto` beneath it inert, so
  one wide table or code block scrolls the document instead of itself. `main`
  in `frontend/app/layout.tsx` carries `min-w-0` for exactly this reason.
  Check any change that touches the app shell's flex layout, and any new
  scroll container that does not scroll.

- **Stale credential health from the wrong authority.** Only a backend-observed
  direct Riot response decides whether the API key is valid: `2xx`/`404`
  validate the current generation, `401`/`403` invalidate it. Cached reads,
  rate limits, job history, locally completed work, and browser memory are all
  neutral — inferring validity from any of them shows a working key as broken
  or the reverse. Flag any client-side or history-derived judgement about key
  validity.

- **Inherited process environment silently beats the env file.** A backend
  configuration name already exported in the shell wins over the value in the
  `.env` being loaded, so the app starts against something other than the file
  it appears to read — in production this once pointed a deploy at an empty
  volume. `run.sh` clears inherited backend configuration names before loading
  the worktree file; `LGA_RUN_USE_PROCESS_ENV=1` is the deliberate one-off
  override. Check any change to config loading or container env wiring, and
  suspect this whenever settings do not match the file on disk.

- **Dropping a populated schema to fix a migration.** Alembic revisions are the
  schema authority; a pre-commit hook blocks `metadata.create_all` and
  `validate_migrations.py` fails on a model change with no revision behind it.
  Neither sees a runtime action: resetting, dropping, or recreating a schema
  that already holds data destroys it just as thoroughly as any bug. The
  baseline revision is deliberately non-reversible, so downgrading past it is
  not a recovery path either. Restore a verified backup instead. Flag any
  change or command that resets, drops, or recreates a populated schema, and
  any suggestion to "just recreate the tables" when a migration misbehaves.

- **PUUID-scoped data answered from user-scoped state, or the reverse.** Player
  records, matches and freshness timestamps are shared by PUUID: every
  application user looking at the same player sees the same rows. Current
  selection, tracked mappings and recent ordering are scoped by authenticated
  application user ID. Inferring either from the other is silent and severe —
  reading a PUUID row as user state shows one account another's selection, and
  writing user state onto a PUUID row leaks it to everyone watching that
  player. Neither typechecks as wrong. Check any query whose `WHERE` mixes
  `puuid` with `user_id`, and any new endpoint that resolves a player without
  saying which of the two it is scoped by.

- **A freshness timestamp advanced by a check that did not fully succeed.**
  `match_synced_at` / `league_synced_at` / `profile_synced_at` may only move
  after the owning provider check succeeds. A clean zero-change check is fresh;
  a partial or failed one is not. Advancing on a partial result is invisible at
  the time and then indistinguishable from real freshness afterwards — the data
  is stale and the UI swears it is current. Check any write to a `*_synced_at`
  column that is not guarded by the success of the check that owns it.

- **An unhandled route failure answers without CORS headers.** The
  `@app.exception_handler(Exception)` in `main.py` becomes Starlette's
  `ServerErrorMiddleware` handler, which sits *outside* every middleware the
  app adds -- so the JSON 500 it emits never passes through `CORSMiddleware`.
  A cross-origin browser client sees an opaque network failure instead of the
  500. Unreachable today: `lib/core/api.ts` resolves `API_BASE_URL` to `""` in
  the browser, so every request the frontend makes is same-origin through the
  Next.js `rewrites()` proxy, and `CORS_ORIGINS` is configured for a client
  that does not exist yet. If one ever does, the fix is a middleware added
  *before* `CORSMiddleware` (the last `add_middleware` call is the outermost),
  not another exception handler. The same seam means `DEBUG=true` shows
  Starlette's traceback page rather than the client-safe body -- production
  and the gate both set `DEBUG=false` explicitly, and `run.sh` clears it.

- **`TypedDict.get("a_key_the_TypedDict_never_declared")` type-checks.**
  Pyright returns `Any | None` rather than reporting the unknown key, so
  renaming a key breaks every `.get()` reader of it without one error, and the
  reader then behaves as though the value were simply absent. In a
  configuration mapping that reads "criterion not set" as "criterion does not
  apply" -- `playstyle_analysis/config.py` is the example -- the result is a
  rule that silently never fires. Indexing (`config["key"]`) *is* checked, and
  so is `NotRequired` access, so prefer `[...]` for required keys. When a
  `.get()` on an optional key is the honest expression, pin the key in a test:
  `tests/test_playstyle_tag_config.py` asserts every evaluator finds the keys
  it reads.
