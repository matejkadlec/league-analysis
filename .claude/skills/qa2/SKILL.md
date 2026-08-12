---
name: qa2
description: Record that the owner failed visual User QA for a League Analysis (LGA) batch and revise the same local work for another owner judgment. Use after the owner rejects a PENDING USER QA batch and whenever the user invokes qa2.
---

# qa2 — User QA Failed, Revise

Purpose: record failed visual QA and revise the same local work. The
repository identity and safety rules in the root `AGENTS.md` apply. The
`flow1` skill owns the `LGA-1` conventions and the User QA launch commands.

## Procedure

1. Keep the issues in `PENDING USER QA`.
2. Preserve and amend the same branch/worktree; do not create replacement Jira
   work or a separate branch for the same failed judgment.
3. Apply the owner's focused feedback, update the existing `LGA-1` entry when
   practical, and rerun affected automated checks.
4. Return the same routes, states, viewports, and interactions for another
   owner judgment, using the `flow1` skill's User QA launch commands.
5. Do not publish a ready pull request or transition to `PENDING CR` until
   `qa1` or explicit owner direction.
