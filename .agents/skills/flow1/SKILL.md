---
name: flow1
description: Autonomously select and deliver a coherent batch of active-sprint LGA Jira work — intake, implement, validate, publish a ready PR, keep Jira current. Use when the user says "flow1" or asks the agent to pick up and deliver sprint work.
---

# flow1 — autonomous batch delivery

Hard boundaries: Jira project `LGA` only. Never push to `master`. PRs are
ready (never draft); the owner merges. `DONE` only after verified merge. A
published PR is owner-managed — do not poll, repair, review, or merge it.

1. **Intake:** inspect the active sprint on Jira board 34 (`NEXT` queue
   first), open PRs, local branches/worktrees, and dirty changes. Skip work
   that overlaps in-flight ownership.
2. **Select** a coherent batch you can implement and validate in one PR. Size
   is your judgment — prefer fewer well-chosen tickets over forced quotas.
   Note skipped candidates and the reason in the final handoff.
3. **Jira:** move selected issues `TO DO` -> `NEXT` -> `IN PROGRESS`; comment
   meaningful progress as you go.
4. **Branch** from current `origin/master`. Use a dedicated linked worktree
   only when working on parallel batches.
5. **Implement**, following the nearest subtree `CLAUDE.md`. Runtime behavior
   changes update the matching topic doc in the same task.
6. **Validate:** focused checks while working; the full `./test.sh` gate
   before publishing.
7. **Intentional visual changes:** transition to `PENDING USER QA`, add a
   concise `LGA-1` entry stating what to check, give the owner copy-pasteable
   launch commands (`cd <worktree> && ./run.sh`) with routes/states/viewports
   to inspect, and stop.
8. **Otherwise:** commit (never bypass hooks), push, open one ready PR to
   `master`, verify the remote PR head reaches your final commit, and
   transition the issues to `PENDING CR`.
9. **Handoff:** ticket-to-PR mapping and validation summary, then stop.
