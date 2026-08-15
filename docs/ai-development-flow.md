# AI Development Flow

> **Authority:** Human-facing index for the Jira/GitHub delivery lifecycle.
> The authoritative agent procedures are the repository skills in
> [`.agents/skills/`](../.agents/skills/).
>
> **Maintenance:** Update when the lifecycle shape, the skill inventory, or
> this index's pointers change. Procedure changes belong in the skill files.

The mandatory repository identity, workflow gate, and safety rules live in
[`../AGENTS.md`](../AGENTS.md). Agents must invoke the matching skill before
Jira intake, Jira-scoped implementation, User-QA handoff or remediation, or PR
publication, and follow its stop boundary.

## Lifecycle

```text
TO DO -> NEXT -> IN PROGRESS -> [PENDING USER QA] -> PENDING CR -> DONE
```

- Jira project `League Analysis` (`LGA`, board `34`) is the planning source of
  truth; `LGA-1` is the Continuous QA issue.
- The **owner** reviews, merges, and deploys. A published pull request is
  owner-managed immediately; `DONE` requires a verified merge into `master`.
- Intentional visual changes pause in `PENDING USER QA` for owner judgment;
  everything else is AI-only QA and proceeds to a ready pull request after
  automated validation.

## Workflow Skills

| Skill | Purpose |
| --- | --- |
| [`flow1`](../.agents/skills/flow1/SKILL.md) | Select and deliver the largest safe coherent batch of existing sprint work: intake, conflict control, batching, branches/worktrees, implementation, validation, ready-PR handoff. Also owns QA classification, `LGA-1` conventions, owner boundaries, and User QA launch commands. |
| [`flow2`](../.agents/skills/flow2/SKILL.md) | Turn a rough user request into planned Jira work (search, create, classify, prioritize), then continue with `flow1`. |
| [`qa1`](../.agents/skills/qa1/SKILL.md) | Record a passed owner visual QA and publish the same work as a ready pull request. |
| [`qa2`](../.agents/skills/qa2/SKILL.md) | Record a failed owner visual QA and revise the same local work for another judgment. |
