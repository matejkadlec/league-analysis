# GitHub Branch Governance

> **Authority:** Repository ruleset configuration for `master` and the stable
> required checks.
>
> **Maintenance:** Update this document whenever the default branch, required
> checks, or review policy changes, and apply the corresponding GitHub
> configuration.

## Scope and source of truth

The canonical repository is `matejkadlec/league-analysis`; its default branch is
`master`. GitHub hosts the active repository ruleset and is the source of truth
for it; this document records what that ruleset must say.

The active ruleset is named **Protect master with verified PR delivery** and
targets only `refs/heads/master`. It requires:

- changes to enter `master` through a pull request;
- resolution of all review conversations;
- stale review approvals to be dismissed after a reviewable push;
- no required approving-review count or last-push approval, preserving the
  workflow without inventing a second reviewer;
- all supported merge methods (`merge`, `squash`, and `rebase`);
- the required check **Deterministic full-project gate**, bound to the GitHub
  Actions integration;
- strict required checks, so a pull request must be current with `master`;
- no bypass actors, no force pushes, and no branch deletion.

Signed commits are deliberately not required: the repository has no shared
verified-signature workflow for Codex or dependency automation. Revisit that
decision only after a compatible signing and recovery process is documented.

The required check context is the stable job name in
[`quality-checks.yml`](../.github/workflows/quality-checks.yml). It covers the
deterministic quality, security, migration, workflow, and repository-tooling
checks in an isolated test container. Dependency
advisories are watched by GitHub's native Dependabot alerts and security
updates instead of a CI job (decision recorded in
[`quality-checks.md`](quality-checks.md)).

## Current verified state

On 2026-08-03, the baseline desired state was applied as GitHub ruleset
[`20327717`](https://github.com/matejkadlec/league-analysis/rules/20327717).
The read-only audit passed against its `master` scope and the two required
contexts. The tracked integration binding is applied through the owner-approved
post-merge administration step below, then verified by the read-only audit.
Disposable PR [#10](https://github.com/matejkadlec/league-analysis/pull/10)
then confirmed that GitHub rejected an early merge, direct push, force push, and
default-branch deletion; the PR was closed and its temporary branch deleted.

Re-read on 2026-11-15 (`gh api repos/matejkadlec/league-analysis/rulesets`):
the active ruleset is
[`20484385`](https://github.com/matejkadlec/league-analysis/rules/20484385),
created 2026-08-06, with the requirements listed above, one required context
(`Deterministic full-project gate`, GitHub Actions, strict), and GitHub's
`require_extra_approval_for_unattributed_changes` switched on. The repository
allows all three merge methods, has auto-merge disabled and deletes head
branches on merge.

## Production environment

The GitHub environment `production` admits the `master` branch only and holds
the restricted deploy key for <https://league.matejkadlec.cz>. The Deploy
workflow runs after Quality Checks succeeds for a push to `master`; its secrets
are never available to a pull request. [Production Deployment](deployment.md)
lists the environment's secrets and variables and what the key can do.

## Safe delivery policy

Dependabot and authorized automation may create branches and pull requests, but
they have no ruleset bypass. The ruleset blocks direct updates, force pushes,
and deletion of `master`, but its zero-review configuration cannot distinguish
the owner from any credential permitted to perform a normal pull-request merge.
Who may merge is therefore a repository workflow policy. The owner authorizes
one automated path: the `finalize-pr` skill of the
[AI development flow](ai-development-flow.md) merges a pull request that a flow
published once an independent review of its exact head is clean, every check is
green and every review thread is resolved, through the normal protected merge
and never with a bypass or auto-merge. A pull request that adds an Alembic
revision or changes the deploy path or production configuration still waits for
the owner's approval of that head. Any other automated merge needs explicit
owner authorization; Dependabot pull requests are never auto-merged.

Do not add a bypass actor for convenience. A documented emergency exception
requires explicit owner approval, the narrowest possible actor and
`pull_request`-only mode, and a follow-up removal/audit. Repository writers
must not weaken this ruleset; only an owner-approved administration change may
alter the reviewed desired state.

## Audit and change procedure

GitHub owns this configuration. Read the live ruleset directly:

```bash
gh api repos/matejkadlec/league-analysis/rulesets
gh api repos/matejkadlec/league-analysis/rulesets/<id>
```

For an intentional policy change, update this document in the same pull request
as the change, then have the owner apply the GitHub administration update and
re-read the live ruleset to confirm it.

Renaming a required check needs care, because a ruleset requiring a context no
workflow emits blocks every pull request permanently. Emit the new job name
first and let it merge, then have the owner add the new context and remove the
old one, and only then remove the old job.

Record the verified ruleset ID and required contexts in the associated LGA
issue. Never put access tokens or configuration secrets in the issue.

The GitHub REST ruleset API requires repository administration permission for a
write, so an unavailable or insufficiently authorized administrator is an owner
boundary rather than a reason to weaken the policy.
