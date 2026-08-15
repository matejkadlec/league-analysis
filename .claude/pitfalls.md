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
