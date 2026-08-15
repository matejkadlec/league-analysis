---
name: qa2
description: Record failed visual QA and revise the same local work for another owner judgment. Use when the user says "qa2" or reports problems with a PENDING USER QA batch.
---

# qa2 — visual QA failed, revise

1. Keep the issues in `PENDING USER QA`.
2. Stay on the same branch/worktree — no replacement Jira work and no separate
   branch for the failed judgment.
3. Apply the owner's focused feedback and update the existing `LGA-1` entry.
4. Rerun the affected automated checks.
5. Return the exact routes, states, viewports, and interactions for another
   owner judgment. No ready PR and no `PENDING CR` until `qa1` or explicit
   owner direction.
