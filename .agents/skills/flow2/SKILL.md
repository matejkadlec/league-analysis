---
name: flow2
description: Turn a rough user request into planned LGA Jira work and deliver it — create or reuse issues in the active sprint, then deliver via the flow1 path. Use when the user says "flow2" or brings a new request that needs planning and implementation.
---

# flow2 — request to delivered work

Hard boundaries match `flow1`: project `LGA` only, never create work in
another Jira project or mutate another repository, never push to `master`,
ready PRs merged by the owner.

1. Clarify only decisions that materially change scope; make the routine
   calls yourself.
2. Search `LGA` for an equivalent open or historical issue; reuse or update
   it instead of duplicating.
3. Determine the active sprint from board 34 — never guess it from dates or
   issue names.
4. Create Task/Bug work (Bug only for confirmed broken behavior) in the
   active sprint, assign a relative priority, and classify QA mode:
   intentional visual change means User QA, everything else is AI-only.
5. Continue as `flow1` from intake through the User QA or ready-PR boundary.
