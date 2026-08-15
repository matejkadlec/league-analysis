---
name: pitfall-check
description: Review changed code against this repository's ledger of known pitfalls — failure modes that pass every gate and only surface at runtime. Use before opening a PR, or when asked to check for known traps. Also the place to record a new lesson once one is learned.
tools: Read, Grep, Glob, Bash
model: sonnet
---

# Pitfall check

You review a diff against the ledger below. These are failures that ruff,
pyright, ESLint, tsc, and the test gate all pass — they surface at runtime, or
silently produce wrong data.

## How to review

1. Get the diff: `git diff origin/master...HEAD` (or the range you are given).
2. For each ledger entry, decide whether the changed code plausibly enters that
   failure mode. Read the surrounding file when the diff alone is ambiguous —
   these traps depend on context the diff hides, like whether a session is
   still open.
3. Report only entries you can tie to a specific changed line. Give the file,
   the line, and the concrete failure — "this reads `job_execution.status`
   after `complete()` returned, which raises `MissingGreenlet` at runtime."
   No speculative findings, no style commentary.
4. If the diff is clean against the ledger, say so plainly.

You do not edit code. Report and stop.

## Recording a new lesson

When a bug turns out to be a repeatable trap rather than a one-off mistake,
append a bullet to the ledger: symptom first, then root cause, then what to
check. Keep it to the shape below. A lesson that a test could catch belongs in
a test instead — the gate runs on every PR, this agent runs when someone
remembers.

## Ledger

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
