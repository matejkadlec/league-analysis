# Pitfalls

Known ways this codebase breaks at runtime while every gate passes — ruff,
pyright, oxlint, tsc, and the test suite all go green and the bug still ships.

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
  `tests/test_job_loops_survive_a_rollback.py` for the two writer loops and
  for a rollback that happens *inside* one iteration (it expires rows with
  SQLAlchemy's own `instance_state`, so it fails the way production does) —
  new code paths are not covered by any of them. The same trap bit the
  tracked-player loops: `handle_player_error` rolls back to skip one player,
  and a row loaded before that rollback raises on its next attribute read.
  It bit again on 2026-08-21, one commit after `must_abort_writer_sync`
  stopped escalating a row-level `IntegrityError`: swallowing the error made
  the writer's own rollback land mid-iteration, where the loop still held a
  `Player`. A callback that closed over the row rather than its id then turned
  a skipped match back into a dead run. **Anything that begins reporting an
  error instead of re-raising it has moved a rollback under code that did not
  previously run after one.**

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

- **Grepping a column name does not prove nothing reads the column.**
  `playstyle_analysis/aggregates.py` resolves a tag's metric with
  `hasattr(MatchParticipant, key[4:])` / `getattr(p, metric)`, so
  `min_skillshots_hit` in `TAG_CONFIG` reaches the `skillshots_hit` column
  through a string that never appears next to the column name. A drop
  migration classified by grep therefore reads as safe, and the loss is
  silent in exactly the way above: `hasattr` is False, the aggregate is 0.0,
  every `min_` comparison fails, and ten tags stop existing with no error and
  a green gate (2026-08-21, caught in review of PR #176). Before dropping or
  renaming any `MatchParticipant` / `Match` column, search for the *stem*
  as well -- `min_<name>`, `max_<name>`, `"<name>"` as a bare string --
  and re-run `tests/test_playstyle_tag_config.py::
  test_every_generic_tag_names_a_metric_that_can_be_read`, which now refuses a
  threshold key that resolves to neither a column nor an `advanced_stats`
  key. `tag_checks.team_attribute_share(p, match, attr)` is the same shape
  with two hard-coded call sites.

- **Deleting an unread `relationship()` can reorder INSERTs and break a
  foreign key.** *Between* mappers, only `relationship()` gives SQLAlchemy's
  unit of work an ordering edge — a `ForeignKey` in the DDL gives it none.
  (Within one mapper hierarchy FKs do order the tables, via
  `Mapper._sorted_tables`; that is not the case here.) Cross-mapper actions
  with no edge form the first topological layer and are emitted in
  `Mapper._sort_key` order, which is the literal string
  `"<module>.<ClassName>"`. The session is `autoflush=False`
  (`core/database.py:42`), so everything pending goes out in one flush at
  `commit()` and that order is the whole contract.

  On 2026-08-21 commit `2356d05` deleted `MatchTimeline.match` and
  `MatchTimeline.player` as unread — they were unread, and they were also the
  only thing putting `core.matches` and `core.players` ahead of
  `core.match_timelines`. Four consecutive production Match Fetcher runs died
  on `fk_match_timelines_puuid_players` for the first match containing a
  player row that did not already exist. Sorted by key,
  `...matches.timeline.MatchTimeline` precedes `...players.models.Player`
  while `...matches.models.Match` precedes both, which is why the *match* FK
  held and the *puuid* FK did not.

  The same commit also deleted `MatchParticipant.player`, and
  `core.match_participants` carries `fk_match_participants_puuid_players` —
  on sort key alone that one would have fired first. It did not only because
  the surviving `Match.participants` relationship pushes
  `SaveUpdateAll(MatchParticipant)` into a later layer. So deleting
  `Match.participants` would put that second foreign key back in layer one.

  Nothing in the gate could see any of it. Before deleting a
  `relationship()`, check whether the flush order it implies is load-bearing;
  where it is, an explicit `await db.flush()` states the dependency the
  relationship used to imply. `replace_match_timeline_rows` does this, and
  `tests/test_timeline.py::test_timeline_rows_are_staged_only_after_a_flush`
  fails if that flush is removed or moved after the rows are staged — it
  cannot see a deleted relationship, so this entry is the only guard for that
  half.

- **`cn()` deletes a class a template literal kept.**
  `house/require-cn-for-classname-composition` routes every composed
  `className` through `twMerge`, which drops the earlier of two conflicting
  Tailwind utilities and resolves the tie by *last listed* rather than by the
  generated stylesheet's order. So a mechanical `` `${a} ${b}` `` → `cn(a, b)`
  conversion can change what renders, with no type, test or lint signal. Both
  directions bit during the oxlint migration on 2026-08-25:
  `frontend/components/sidebar-nav.tsx` had a static `text-white` colliding
  with the active `text-[#cfa93a]`, and
  `frontend/features/matchmaking/components/matchmaking-analysis-history.tsx`
  had a static `h-11` that had *already* been beating a conditional `h-0` under
  the old literal, so the row never collapsed. When converting, state each
  conflicting class per branch rather than leaving a static base to be merged
  away. Partly enforceable: the plugin could run `twMerge` over
  statically-known string arguments and report a drop, which would leave only
  the dynamic-value cases here.

- **A same-length constant edit can be masked by a stale `.pyc`.** CPython
  invalidates cached bytecode on source `(mtime, size)`. `min_length=1` →
  `min_length=0` changes neither, and `mtime` has one-second granularity, so
  a mutate/run/restore cycle completing inside a second reuses the mutant
  bytecode. The failure mode is the dangerous direction: a red/green proof
  reports **pass** for a guard that is not there. It cost two false readings
  on 2026-08-21. When red-proving a same-length edit, `touch` the file or run
  with `PYTHONPYCACHEPREFIX` pointed somewhere fresh, and treat an
  unexpected pass as suspect before an unexpected failure.

- **A strict enum on a Riot payload fails the whole response, not one field.**
  Riot keeps adding ranked ladders, and a new one brings its own vocabulary:
  `JADE_RANKED_SOLO_5x5` returns tier `SALT`, which is not a `Tier`. Because
  `get_league_entries_by_puuid` built every `LeagueEntryDTO` eagerly, that one
  sibling entry failed the list and the Solo/Duo entry beside it was never
  read. The damage was doubled by where it surfaced: a `ValidationError` is not
  a `RiotAPIError`, so `_api_call_with_retries` did not recognise it and the
  matchmaking run died on the catch-all "did not finish" message with nothing
  naming the cause. It cost two failed 100-match runs on 2026-08-27, and only
  because a spine that long reached a lobby containing such an account.
  `test_by_puuid_league_drops_a_ladder_with_its_own_tier_vocabulary` covers the
  ladder known today. When a Riot DTO field is an enum, ask what happens to its
  *siblings* in the same response when Riot adds a member, and prefer widening
  the failure to one dropped record over one dropped response.

- **A backend test reads frontend source, so refactoring a URL literal breaks
  the gate from the other language.** `backend/tests/test_frontend_api_paths.py`
  walks `frontend/` and regex-matches `validated(Get|Post|Put|Delete|Patch)(`
  call sites, then asserts every URL it finds is a route `app` actually answers.
  The two halves deploy separately and agree on nothing but strings, and every
  frontend test that touches an API module mocks it, so a mistyped path stays
  green until it 404s in a browser — hence the scan. The consequence for
  refactoring: hoisting a path behind a constant, threading it through a
  helper, or building it by interpolation makes the literal invisible to the
  regex, and the check silently stops covering that call. A frontend-only
  cleanup can therefore fail `./test.sh -b`, which is the last place anyone
  looks. Keep `validatedPost("/jobs/…")` URL arguments inline as literals at
  the call site, and when a decomposition step wants to move one, move the
  whole call.
