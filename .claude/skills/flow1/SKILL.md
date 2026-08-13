---
name: flow1
description: Autonomously select and deliver the largest safe coherent batch of League Analysis (LGA) Jira work through intake, conflict control, batching, branch/worktree lifecycle, implementation, validation, and ready pull-request handoff. Use for any Jira intake or selection, Jira-scoped implementation, or pull-request publication in this repository, and whenever the user invokes flow1.
---

# flow1 — Select and Deliver Sprint Work

Purpose: autonomously select and deliver the largest safe coherent batch, or a
bounded set of preselected independent AI-only batches, from existing
active-sprint work. This skill is the authoritative procedure for Jira intake,
batching, QA classification, branches/worktrees, pull requests, remediation,
and owner handoff. The repository identity and safety rules in the root
`AGENTS.md` apply and cannot be weakened here.

`flow1` completes at the first visual/owner-boundary handoff or the final
ready-pull-request handoff, not at merge.

## Roles and Sources of Truth

- Jira project `League Analysis` (`LGA`) is the planning and execution-state
  source of truth. Board `34` supplies the active sprint. `LGA-1` is the
  Continuous QA issue and owns durable QA evidence conventions.
- The Git repository owns implementation state. `origin/master` is the normal
  starting point for new task work. `docs/` owns durable architecture,
  integration, schema, and workflow decisions.
- The **owner** is the user responsible for subjective QA, pull request review,
  merge, and deployment unless they explicitly delegate a specific action.
- The **local agent** owns the authorized implementation scope, proportional
  automated validation, and any delivery steps granted by this skill or the
  user's explicit request.

## Jira Lifecycle

```text
TO DO -> NEXT -> IN PROGRESS -> [PENDING USER QA] -> PENDING CR -> DONE
```

- `TO DO`: accepted active-sprint work not yet in the immediate queue.
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

## QA Classification

Classify each issue or safely separable batch before implementation.

**AI-only QA:** backend, database, schema, infrastructure, tooling, CI,
documentation, security, authentication, external integrations, tests,
refactors, and frontend state/validation/routing/data logic that does not
intentionally change rendered appearance. AI-only work proceeds from
`IN PROGRESS` to a ready pull request and `PENDING CR` after automated
validation.

**User QA:** intentional changes to layout, styling, responsive behavior,
motion, imagery, icons, visible components or controls, or visible copy when
it materially changes visual balance or wrapping.

Partition mixed scope by QA mode when the pieces can be implemented and
reviewed independently. If they cannot be safely separated, classify the whole
batch as User QA. User QA never replaces automated validation.

## Continuous QA (`LGA-1`)

Read the current `LGA-1` description before adding or updating evidence; its
live convention overrides stale recollection.

- AI QA entries start with `🤖 <Agent> QA` (for example `🤖 Codex QA`), never
  use a user-priority emoji, and record concise validation, impacted areas,
  known limitations, environment constraints, or follow-up recommendations.
  For small follow-up fixes, update an existing relevant entry when practical.
- User QA entries state only the remaining visual or subjective judgment and
  use the priority convention currently defined by `LGA-1`
  (`🟦 Low` / `🟨 Medium` / `🟧 High` / `🟥 Urgent`). Owner reactions: `👍`
  seen and/or verified; `⏳` acknowledged but not yet tested.

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

Select the largest safe coherent batch available within the active sprint and
curated `NEXT` queue. Expected planning scale is approximately **3 large**, **5
medium**, or **10 small** tickets, or a sensible mixed batch with comparable
total complexity. These are planning expectations, not hard quotas or
changed-line budgets.

Build each coherent batch using active-sprint priority and `NEXT` order, QA
mode and any distinct owner judgment, dependencies and prerequisite order,
shared domains and overlapping files, conflict and ownership boundaries, and
verification path, reviewability, and rollback safety. Active-sprint work
outranks future-sprint work. Select from `NEXT` first and replenish it from
eligible active-sprint `TO DO` work before it becomes empty.

Compatible AI-only tickets from different areas may share one pull request when
they do not conflict, remain reviewable, and one reliable gate validates them.
Split work when combining it would mix distinct owner judgments, introduce an
unsafe dependency, stack unrelated risk, or make review and rollback materially
worse. A small changed-line count is never by itself a reason to stop after one
ticket.

When selecting materially fewer tickets than the expected scale, state the
concrete dependency, conflict, uncertainty, owner boundary, or lack of
compatible candidates. Maintain an explicit batch ledger from intake through
handoff with:

- selected ticket keys and their QA mode;
- excluded candidates and concrete reasons;
- planned pull-request grouping and dependency bases;
- branch and worktree for every planned pull request;
- validation performed and final ticket-to-PR mapping.

When the user names existing issues, use that exact scope and reconcile it
against live state instead of autonomously replacing it. Record that hard scope
as the reason when it makes the selected batch materially smaller.

### Independent pull requests in one invocation

Prefer one coherent multi-ticket pull request. At most **two** independently
selected batches may be pending or unmerged at once, counting both `PENDING CR`
and `PENDING USER QA`. If independently reviewable work should not share a
rollback or review boundary, one `flow1` invocation may publish up to two ready
pull requests within that limit.

- Preselect every planned batch and its PR mapping during intake.
- Give each pull request its own focused branch and linked worktree from the
  verified current `origin/master`, unless a real dependency requires a
  documented stacked base.
- Do not stack pull requests merely for convenience.
- A published PR becomes owner-managed immediately. Do not poll CI or review,
  request review, inspect or remediate published feedback, merge, or deploy it.
- Continue after publication only with an independent batch recorded in the
  intake ledger that stays within the pending-batch limit; do not add
  opportunistic work.
- Stop the remaining invocation immediately if it encounters User QA, a
  secret/provider action, destructive uncertainty, an architecture/product
  decision, a conflict, a baseline failure, or another genuine owner boundary.
- Final handoff maps every selected ticket to its pull request and reports all
  validation and owner actions once, after the last preselected batch.

### Representative dry run

This non-live example demonstrates the decision, not real Jira assignments:

| Example tickets | Decision | Reason |
| --- | --- | --- |
| `LGA-101` through `LGA-106` | PR 1 | Six small AI-only workflow/docs checks share files, one gate, and one rollback boundary. |
| `LGA-107` through `LGA-109` | PR 2 | Three small AI-only ingestion fixes are independent but would materially complicate review and rollback if mixed with repository workflow tooling. |
| `LGA-110` | Excluded from this invocation | Its intentional UI change requires a separate User QA judgment. |

The nine selected small tickets are near the planning expectation, use two
independent worktrees, and remain below the default two-PR ceiling.

## Branch and Worktree Lifecycle

- Do not push task work directly to `master` without an explicit user
  exception.
- Start normal work from current `origin/master`.
- Newly selected `flow1` task work uses a dedicated linked worktree by default.
  Continuing an existing branch/worktree is allowed when it already owns the
  exact scope. Working in the primary checkout requires a concrete exceptional
  reason in the batch ledger.
- Use deterministic names: branch `flow1/<jira-keys>-<scope>` and a sibling
  worktree directory derived from the repository, Jira keys, and short scope.
  Lowercase keys in Git names and keep the scope filesystem-safe.
- Fetch and inspect conflicts first, then create each new branch/worktree from
  current `origin/master`. Independent pull requests use separate worktrees and
  do not share a task branch.
- Never overwrite or clean unrelated dirty changes.
- Treat stale or abandoned branches/worktrees as ownership evidence until their
  PR, merge, dirty state, and owner are verified. Never delete or reset an
  owner-created worktree without explicit authorization.
- Rebase a stale branch before publication. If a published branch must be
  updated after rebase, use `--force-with-lease`; never use unsafe force push.
- Preserve a worktree through User QA and any expected remediation. Cleanup is
  allowed only after its branch is safely published and the worktree is no
  longer needed for User QA or remediation; do not infer that from elapsed time.
- Keep commits coherent and reviewable. Do not bypass pre-commit hooks.

Git materializes only tracked files into a new worktree, and root `.env` is
ignored, so copy it explicitly when creating one:

```bash
git worktree add -b <branch> <path> origin/master
cp .env <path>/.env   # Only when the source checkout has one
```

Copy that one file only — never a directory, deployment credential, or provider
bundle. Never overwrite an existing target.

Before any GitHub write, re-verify the current `origin` remote and exact target
repository.

## Implementation and Pre-Publication Remediation

1. Read the root and nearest scoped `AGENTS.md` files plus authoritative topic
   documentation.
2. Move selected issues through `NEXT` to `IN PROGRESS`.
3. Implement only the coherent authorized scope.
4. Keep authoritative docs and scoped agent guidance synchronized with runtime
   changes.
5. Run focused checks relevant to the changed files and risk area during
   implementation, then run the complete `./test.sh` gate before publication;
   focused `-f`/`-b` modes are implementation feedback, not substitutes for
   the complete PR gate. Do not duplicate an unambiguous successful full gate
   against an unchanged worktree.
6. Inspect the final diff for scope, secrets, generated-file drift, and
   accidental user-change overlap.
7. Automatically fix safely remediable pre-publication defects within the same
   scope, then rerun affected checks.

Do not escalate ordinary lint, type, formatting, link, or focused regression
failures before attempting a safe fix.

## Local Assistance and User QA Launch

- When the owner can resolve something through the terminal, provide complete,
  copy-pasteable command(s), not a partial command or an assumed working
  directory.
- Agents may run commands needed for authorized implementation, validation, and
  workflow steps, including the narrowly scoped private `.env` fallback below
  when it is needed to validate or launch an exact linked worktree.
- Never inspect, print, stage, commit, or otherwise expose `.env` contents.
  Copying it at worktree creation, as above, remains the preferred path.

When a batch requires User QA, give the owner complete copy-pasteable
command(s) to start the app from the exact worktree containing that batch. If
that worktree does not have its ignored `.env`, provide this mode-600,
no-overwrite command before the launch command, or run it when necessary for
the authorized workflow:

```bash
(
  if [ -e "<qa-worktree>/.env" ] || [ -L "<qa-worktree>/.env" ]; then
    printf '%s\n' 'Refusing to overwrite the existing QA .env file.' >&2
    exit 1
  fi
  install -m 600 -- "<primary-worktree>/.env" "<qa-worktree>/.env"
)
```

Use exact absolute paths, never overwrite an existing target, and do not
inspect, print, or stage any `.env` value. Then provide `cd <qa-worktree>`
followed by `./run.sh`. If the batch is in the primary `master` worktree,
provide `cd <primary-worktree>` followed by `./run.sh` instead.

## User QA Path

For a User QA batch:

1. Complete implementation and automated validation locally.
2. Keep the branch/worktree available and transition the issues to
   `PENDING USER QA`.
3. Add or update the `LGA-1` entry with only the remaining visual/subjective
   checks and the current user-priority convention.
4. Provide the owner the User QA launch command(s), exact routes, states,
   viewports, and interactions to inspect.
5. Stop for owner judgment. Do not publish a ready pull request until the owner
   passes the visual scope or explicitly changes the lifecycle.

Use the `qa1` skill after a pass and the `qa2` skill after a failure.

## Ready Pull Request and Owner Handoff

When publication is authorized by the user or a named workflow:

1. Reconcile with current `origin/master` and resolve task-scope conflicts.
2. Run the complete `./test.sh` local gate.
3. Commit intentionally without bypassing hooks.
4. Push the focused branch to `matejkadlec/league-analysis`.
5. Create or update a **ready** pull request, never a draft, targeting
   `master`.
6. Read back the actual remote pull-request head, verify the final commit is
   reachable from it, and record the current Quality Checks state. A queued,
   in-progress, blocked, or missing remote check is not a successful check.
7. Include issue keys, scope, validation, the remote-delivery proof, and any
   owner-relevant limitations.
8. Transition the associated `LGA` issues to `PENDING CR`.
9. Mark this PR owner-managed immediately. Continue only if the intake ledger
   contains another preselected independent AI-only batch; otherwise provide
   the final handoff and return control to the owner.

After publishing or updating the ready pull request, do not poll review or CI,
request automated review, delegate repair, resolve unrelated review threads,
merge, or deploy it. The narrow multi-PR exception permits work only on another
independent batch preselected during the same intake; it never permits managing
the published PR. After the final preselected PR, report the complete ledger and
stop.

A later `continue` or `resume` requires fresh inspection of GitHub, Jira,
`origin/master`, CI/CD state, and relevant runtime/live state before
reconciliation.

Codex Review is optional, not a required merge gate. The owner may explicitly
delegate one review pass for a named high-risk pull request. Do not create an
automatic review-remediation-rereview loop, and address review findings only
when the owner delegates that named pull request.

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

Stop and ask the owner when completion requires a changed product or
architecture decision; secrets, provider credentials, or access the agent
cannot safely establish; destructive scope that was not already authorized;
action against uncertain live state; a failed rollback or evidence that
continuing could lose data; weakening a security or compliance boundary;
substantial unrelated scope; or a cross-project or cross-repository action.

Never ask the owner to paste secrets or a complete environment file into chat
or Jira.

When an external control is required but cannot be safely accessed or changed,
report the observed evidence, likely root cause, exact owner action and control
location, non-secret identifiers or values needed, and the verification to run
afterward. Once the owner confirms that action, re-inspect the control and
resume or retry the original task. Do not repeat local work that cannot affect
the external control.

## Procedure

1. Run the full intake and conflict-control inspection.
2. Maximize the safe selection from the active sprint and curated `NEXT` queue
   using expected scale, priority, QA mode, dependencies, conflicts,
   verification, reviewability, and rollback scope. Record the batch ledger and
   concrete reasons for exclusions or an undersized selection.
3. Move selected work through `TO DO` -> `NEXT` -> `IN PROGRESS` as needed.
4. Create/use a dedicated focused branch and linked worktree from current
   `origin/master` for every planned PR.
5. Implement, update documentation, validate, inspect the diff, and remediate
   safe pre-publication defects.
6. If User QA is required, transition to `PENDING USER QA`, update `LGA-1`,
   provide the visual checklist, and stop.
7. Otherwise commit, push, open/update each preselected ready pull request, and
   transition its issues to `PENDING CR`. Treat every published PR as
   owner-managed immediately; continue only with another preselected
   independent AI-only batch within the two-pending-batch limit.
8. Provide one final ledger mapping tickets, branches/worktrees, validation, and
   pull requests, then stop.
