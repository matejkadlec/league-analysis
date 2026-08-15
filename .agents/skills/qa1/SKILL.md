---
name: qa1
description: Record that the owner passed visual QA and publish the same work as a ready PR. Use when the user says "qa1" or confirms a PENDING USER QA batch looks good.
---

# qa1 — visual QA passed, publish

Hard boundaries match `flow1`: project `LGA` only, never push to `master`,
ready PRs merged by the owner, published PRs are owner-managed.

1. Verify the exact `PENDING USER QA` issues, their branch/worktree, and the
   owner's approval.
2. Update or remove the corresponding `LGA-1` entry; preserve useful AI
   evidence.
3. Reconcile with current `origin/master` and run the full `./test.sh` gate.
4. Commit the approved scope, push the same branch, open/update the ready PR
   targeting `master`, and transition the issues to `PENDING CR`.
5. Hand off and stop.
