# AI Development Flow

> **Authority:** Repository-wide Jira intake, work selection, batching, QA,
> Git, pull request, remediation, and owner-handoff lifecycle.
>
> **Maintenance:** Update when Jira statuses, board conventions, QA policy,
> GitHub lifecycle, validation commands, or workflow shortcuts change.

This document supplements the mandatory repository identity and safety rules in
[`../AGENTS.md`](../AGENTS.md). If a target does not match those rules, stop
before writing and correct the target; never infer a project or repository from
the authenticated account.

## Roles and Sources of Truth

- Jira project `League Analysis` (`LGA`) is the planning and execution-state
  source of truth. Board `34` supplies the active sprint.
- `LGA-1` is the Continuous QA issue and owns durable QA evidence conventions.
- The Git repository owns implementation state. `origin/master` is the normal
  starting point for new task work.
- `docs/` owns durable architecture, integration, schema, and workflow
  decisions.
- The **owner** is the user responsible for subjective QA, pull request review,
  merge, and deployment unless they explicitly delegate a specific action.
- The **local agent** owns the authorized implementation scope, proportional
  automated validation, and any delivery steps granted by this document's
  named workflows or the user's explicit request.

## Jira Lifecycle

The normal path is:

```text
TO DO -> NEXT -> IN PROGRESS -> [PENDING USER QA] -> PENDING CR -> DONE
```

- `TO DO`: accepted active-sprint work that is not yet in the immediate queue.
- `NEXT`: curated immediate execution queue. Newly selected work passes through
  `TO DO` -> `NEXT` -> `IN PROGRESS`; do not skip the queue transition.
- `IN PROGRESS`: implementation or AI validation is actively owned.
- `PENDING USER QA`: optional state used only for intentional visual changes
  awaiting owner judgment.
- `PENDING CR`: a ready pull request exists. Review, CI, repair, merge, and
  deployment are owner-managed unless explicitly delegated for that pull
  request.
- `DONE`: the associated pull request is verified merged into `master`.
- `REJECTED`: invalid, duplicate, cancelled, or intentionally out-of-scope
  work. Record the reason when using it.

Before every Jira write, verify the issue key starts with `LGA-` and that the
issue belongs to project `League Analysis`.

## Issue Creation, Sprint, and Priority

1. Search `LGA` for an equivalent open or historical issue before creating
   work. Reuse or update the existing issue when it represents the same scope.
2. Put user-requested implementation work in the current active sprint unless
   the user explicitly requests the backlog or another sprint.
3. Determine the active sprint from Jira board `34`; never guess it from dates,
   issue names, or the last observed sprint.
4. Use:
   - **Task** for planned implementation, documentation, refactoring, or
     maintenance.
   - **Bug** only for confirmed broken behavior.
   - **Epic** for at least three related non-trivial tasks or an explicit
     roadmap grouping.
5. Treat Jira priority as relative to the active sprint. Use priority, `NEXT`,
   dependencies, conflicts, and risk together when selecting work.

## QA Classification

Classify each issue or safely separable batch before implementation.

### AI-only QA

Use AI-only QA for:

- backend, database, schema, infrastructure, tooling, CI, and documentation;
- security, authentication, external integrations, tests, and refactors;
- frontend state, validation, routing, or data logic that does not
  intentionally change rendered appearance.

AI-only work proceeds from `IN PROGRESS` to a ready pull request and
`PENDING CR` after automated validation.

### User QA

Use User QA for intentional changes to:

- layout, styling, responsive behavior, or motion;
- imagery, icons, visible components, or controls;
- visible copy when it materially changes visual balance or wrapping.

Partition mixed scope by QA mode when the pieces can be implemented and
reviewed independently. If they cannot be safely separated, classify the whole
batch as User QA. User QA never replaces automated validation.

## Continuous QA (`LGA-1`)

Read the current `LGA-1` description before adding or updating evidence; its
live convention overrides stale recollection.

### AI QA entries

- Start with `🤖 <Agent> QA`, for example `🤖 Codex QA`.
- Do not use a user-priority emoji.
- Record concise validation, impacted areas, known limitations, environment
  constraints, or follow-up recommendations.
- For small follow-up fixes, update an existing relevant entry when practical
  instead of adding duplicates.

### User QA entries

State only the remaining visual or subjective judgment. Use the priority
convention currently defined by `LGA-1`:

- `🟦 Low`: can wait for a longer period.
- `🟨 Medium`: useful to test but can wait; default for most entries.
- `🟧 High`: should be tested before completion but is not urgent.
- `🟥 Urgent`: must be tested before completion.

Owner reactions currently mean:

- `👍`: seen and/or verified.
- `⏳`: acknowledged but not yet tested.

## Intake and Conflict Control

Before autonomous selection or resumption, inspect current live state:

1. Verify Jira project `LGA`, GitHub repository
   `matejkadlec/league-analysis`, and the current `origin` remote.
2. Fetch/read current `origin/master`.
3. Determine board `34`'s active sprint and inspect its `NEXT`, `TO DO`,
   `IN PROGRESS`, `PENDING USER QA`, and `PENDING CR` work.
4. Inspect open and draft pull requests and their branches.
5. Inspect local branches, worktrees, current branch, and dirty/untracked
   changes.
6. Preserve unrelated user changes and worktrees.

Treat `IN PROGRESS`, `PENDING USER QA`, `PENDING CR`, open pull requests, and
active branches/worktrees as ownership signals. Build a conflict map of
overlapping files, features, schemas, dependencies, and shared infrastructure.
Do not take or force overlapping work when ownership is unclear.

## Selection and Batching

Build one safe, coherent batch using:

- active-sprint priority and `NEXT` order;
- QA mode;
- domain and implementation similarity;
- dependencies and prerequisite order;
- conflict and ownership boundaries;
- shared verification scope.

Ticket counts are guidance, not quotas. Never use a changed-line budget as a
selection or stopping rule. Split work when it would mix unrelated behavior,
independent risk, conflicting ownership, or distinct owner judgments.

When the user names existing issues, use that exact scope and reconcile it
against live state instead of autonomously replacing it.

## Branch and Worktree Lifecycle

- Do not push task work directly to `master` without an explicit user
  exception.
- Start normal work from current `origin/master`.
- Use a focused branch named for the task or coherent batch.
- Prefer a Git worktree when another branch must remain available for review,
  User QA, or parallel non-overlapping work.
- Never overwrite or clean unrelated dirty changes.
- Rebase a stale branch before publication. If a published branch must be
  updated after rebase, use `--force-with-lease`; never use unsafe force push.
- Keep commits coherent and reviewable. Do not bypass pre-commit hooks.

Before any GitHub write, re-verify the current `origin` remote and exact target
repository.

## Implementation and Pre-Publication Remediation

1. Read the root and nearest scoped `AGENTS.md` files plus authoritative topic
   documentation.
2. Move selected issues through `NEXT` to `IN PROGRESS`.
3. Implement only the coherent authorized scope.
4. Keep authoritative docs and scoped agent guidance synchronized with runtime
   changes.
5. Run the checks required by
   [`project-overview.md`](project-overview.md#quality-and-verification).
6. Inspect the final diff for scope, secrets, generated-file drift, and
   accidental user-change overlap.
7. Automatically fix safely remediable pre-publication defects within the same
   scope, then rerun affected checks.

Do not escalate ordinary lint, type, formatting, link, or focused regression
failures before attempting a safe fix.

## User QA Path

For a User QA batch:

1. Complete implementation and automated validation locally.
2. Keep the branch/worktree available and transition the issues to
   `PENDING USER QA`.
3. Add or update the `LGA-1` entry with only the remaining visual/subjective
   checks and the current user-priority convention.
4. Provide the owner exact routes, states, viewports, and interactions to
   inspect.
5. Stop for owner judgment. Do not publish a ready pull request until the owner
   passes the visual scope or explicitly changes the lifecycle.

Use `qa1` after a pass and `qa2` after a failure.

## Ready Pull Request and Owner Handoff

When publication is authorized by the user or a named workflow:

1. Reconcile with current `origin/master` and resolve task-scope conflicts.
2. Run the complete applicable local gate.
3. Commit intentionally without bypassing hooks.
4. Push the focused branch to `matejkadlec/league-analysis`.
5. Create or update a **ready** pull request, never a draft, targeting
   `master`.
6. Include issue keys, scope, validation, and any owner-relevant limitations.
7. Transition the associated `LGA` issues to `PENDING CR`.
8. Return control to the owner immediately.

After publishing or updating the ready pull request, do not poll review or CI,
request automated review, delegate repair, resolve unrelated review threads,
merge, deploy, or select another batch unless the owner explicitly delegates
those actions for that exact pull request.

A later `continue` or `resume` requires fresh inspection of GitHub, Jira,
`origin/master`, CI/CD state, and relevant runtime/live state before
reconciliation.

## Completion and Rejection

- Transition an issue to `DONE` only after verifying its pull request is merged
  into `master`.
- If several issues share a pull request, keep all in `PENDING CR` until that
  merge is verified.
- Use `REJECTED` only for an invalid, duplicate, cancelled, or intentionally
  out-of-scope issue and record the reason.
- A local implementation or successful local gate is not evidence of merge or
  GitHub check success.

## Genuine Owner Boundaries

Stop and ask the owner when completion requires:

- a changed product or architecture decision;
- secrets, provider credentials, or access the agent cannot safely establish;
- destructive scope that was not already authorized;
- action against uncertain live state;
- a failed rollback or evidence that continuing could lose data;
- weakening a security or compliance boundary;
- substantial unrelated scope;
- cross-project or cross-repository action.

Never ask the owner to paste secrets or a complete environment file into chat
or Jira.

## Workflow Shortcuts

### `flow1`

Purpose: autonomously select and deliver one safe coherent batch from existing
active-sprint work.

1. Run the full intake and conflict-control inspection.
2. Select from the active sprint and curated `NEXT` queue using priority, QA
   mode, similarity, dependencies, conflicts, and verification scope.
3. Move selected work through `TO DO` -> `NEXT` -> `IN PROGRESS` as needed.
4. Create/use a focused branch or worktree from current `origin/master`.
5. Implement, update documentation, validate, inspect the diff, and remediate
   safe pre-publication defects.
6. If User QA is required, transition to `PENDING USER QA`, update `LGA-1`,
   provide the visual checklist, and stop.
7. Otherwise commit, push, open/update a ready pull request, transition to
   `PENDING CR`, hand off to the owner, and stop immediately.

`flow1` completes at visual handoff or ready-pull-request handoff, not at merge.

### `flow2`

Purpose: turn rough user requests into planned Jira work, then implement the
safe coherent scope.

1. Verify the request belongs to `LGA`; clarify only a decision that would
   materially change scope.
2. Search for equivalent `LGA` issues and reuse them where appropriate.
3. Determine the current active sprint from board `34`.
4. Create or update Task/Bug/Epic work using the issue-type rules, place
   user-requested implementation in that sprint unless directed elsewhere,
   assign relative priority, and classify QA mode.
5. Identify dependencies, conflicts, and a safe coherent batch.
6. Continue with `flow1` from intake through the same User QA or ready-PR stop
   boundary.

`flow2` never creates work in another Jira project or mutates another GitHub
repository without explicit cross-target authorization.

### `qa1`

Purpose: record that the owner passed visual QA and publish the same work.

1. Verify the exact `PENDING USER QA` issues, branch/worktree, and current owner
   approval.
2. Remove or update the corresponding pending User QA entry in `LGA-1` as
   appropriate; preserve useful AI evidence.
3. Reconcile with current `origin/master` and run the complete applicable gate.
4. Commit the approved scope, push the same focused branch, create/update a
   ready pull request, and transition the issues to `PENDING CR`.
5. Hand off and stop immediately under the ready-PR boundary.

### `qa2`

Purpose: record failed visual QA and revise the same local work.

1. Keep the issues in `PENDING USER QA`.
2. Preserve and amend the same branch/worktree; do not create replacement Jira
   work or a separate branch for the same failed judgment.
3. Apply the owner's focused feedback, update the existing `LGA-1` entry when
   practical, and rerun affected automated checks.
4. Return the same routes, states, viewports, and interactions for another
   owner judgment.
5. Do not publish a ready pull request or transition to `PENDING CR` until
   `qa1` or explicit owner direction.
