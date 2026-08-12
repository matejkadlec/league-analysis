---
name: qa1
description: Record that the owner passed visual User QA for a League Analysis (LGA) batch and publish the same work as a ready pull request. Use after the owner approves a PENDING USER QA batch and whenever the user invokes qa1.
---

# qa1 — User QA Passed, Publish

Purpose: record that the owner passed visual QA and publish the same work. The
repository identity and safety rules in the root `AGENTS.md` apply. The
`flow1` skill owns the ready-PR mechanics, the `LGA-1` conventions, and the
User QA launch commands referenced below.

## Procedure

1. Verify the exact `PENDING USER QA` issues, branch/worktree, and current owner
   approval.
2. Remove or update the corresponding pending User QA entry in `LGA-1` as
   appropriate; preserve useful AI evidence.
3. Reconcile with current `origin/master` and run the complete applicable gate.
4. Commit the approved scope, push the same focused branch, create/update a
   ready pull request, and transition the issues to `PENDING CR`, following
   the `flow1` skill's Ready Pull Request and Owner Handoff steps.
5. Hand off and stop immediately under the ready-PR boundary.
