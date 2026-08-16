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
  per-function guards: `test_get_job_logs_never_touches_the_orm_instance` and
  `test_failure_from_job_never_touches_the_execution_instance` — new code
  paths are not covered by either.

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

- **`NameError` from an annotation nothing appears to evaluate.** A function
  whose parameters are typed with a `TYPE_CHECKING`-only import raises
  `NameError: name 'RiotAPIClient' is not defined` the first time it is
  *called* — not imported — if anything evaluates its annotations at runtime.
  Under PEP 649 annotations are lazy, so the definition is fine and the module
  imports clean; `inspect.signature()`, `typing.get_type_hints()` and any
  library reflecting over a signature evaluate them with the default
  `Format.VALUE` and resolve the name in a module namespace that never
  imported it. Ruff's `UP037` actively creates the condition by stripping the
  quotes that used to make these annotations safe, so the gate does not merely
  miss this — it introduces it, and pyright agrees the name is valid because
  it honours `TYPE_CHECKING`. Existing guards, none of them general:
  `app/core/decorators.py` builds its binding signature once via
  `_binding_signature()` using `annotationlib.Format.STRING`; SQLAlchemy reads
  mapped-class annotations with `Format.FORWARDREF`, so `Mapped[...]`
  relationships degrade to a `ForwardRef` instead of raising; and the test
  suite only covers call paths it already exercises. Check any new use of
  `inspect.signature` or `get_type_hints` on a function that could carry a
  `TYPE_CHECKING`-only annotation, and suspect this whenever a method fails on
  first call while its module imports fine.

- **A freshness timestamp advanced by a check that did not fully succeed.**
  `match_synced_at` / `league_synced_at` / `profile_synced_at` may only move
  after the owning provider check succeeds. A clean zero-change check is fresh;
  a partial or failed one is not. Advancing on a partial result is invisible at
  the time and then indistinguishable from real freshness afterwards — the data
  is stale and the UI swears it is current. Check any write to a `*_synced_at`
  column that is not guarded by the success of the check that owns it.
