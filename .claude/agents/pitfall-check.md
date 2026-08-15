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

- **A failed background run looks like a successful one.** Background runs
  answer HTTP 200 whether they succeeded, failed, or are still in flight — the
  status code carries no outcome. Any consumer must read the persisted
  `status` field before rendering `results`. The schemas do not enforce this:
  `MatchmakingAnalysisResponseSchema` and `SmurfBoostAnalysisResponseSchema`
  are flat objects whose `results` is independently nullable, so
  `if (data.results) render(data.results)` type-checks against a `failed`
  payload. Smurf & Boost is covered by tests (`smurf-boost-detection.test.tsx`
  asserts both the 200-failed and 200-in_progress paths); Matchmaking Analysis
  is not — `MatchmakingAnalysisResults`, which holds the
  `status !== "completed"` guard, is rendered by no test. Check matchmaking
  result rendering closely.

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
