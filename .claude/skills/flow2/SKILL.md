---
name: flow2
description: Turn a rough user request into planned League Analysis (LGA) Jira work — search, create, or update issues in the active sprint with correct type, priority, and QA classification — then implement the safe coherent scope through the flow1 procedure. Use for Jira issue creation from user requests and whenever the user invokes flow2.
---

# flow2 — Plan Rough Requests into Jira, Then Deliver

Purpose: turn rough user requests into planned Jira work, then implement the
safe coherent scope. The repository identity and safety rules in the root
`AGENTS.md` apply and cannot be weakened here. Read the `flow1` skill before
the implementation phase; it owns intake, batching, QA classification detail,
branches/worktrees, validation, and the ready-PR handoff.

## Procedure

1. Verify the request belongs to `LGA`; clarify only a decision that would
   materially change scope.
2. Search `LGA` for an equivalent open or historical issue before creating
   work. Reuse or update the existing issue when it represents the same scope.
3. Determine the current active sprint from Jira board `34`; never guess it
   from dates, issue names, or the last observed sprint.
4. Create or update work using the issue-type rules below, place
   user-requested implementation in that sprint unless directed elsewhere,
   assign relative priority, and classify QA mode (see the `flow1` skill's QA
   classification).
5. Identify dependencies, conflicts, and a safe coherent batch.
6. Continue with the `flow1` procedure from intake through the same User QA or
   ready-PR stop boundary.

## Issue Types, Sprint, and Priority

- **Task** for planned implementation, documentation, refactoring, or
  maintenance.
- **Bug** only for confirmed broken behavior.
- **Epic** for at least three related non-trivial tasks or an explicit roadmap
  grouping.
- Put user-requested implementation work in the current active sprint unless
  the user explicitly requests the backlog or another sprint.
- Treat Jira priority as relative to the active sprint. Use priority, `NEXT`,
  dependencies, conflicts, and risk together when selecting work.

Before every Jira write, verify the issue key starts with `LGA-` and that the
issue belongs to project `League Analysis`. `flow2` never creates work in
another Jira project or mutates another GitHub repository without explicit
cross-target authorization.
