# GitHub Branch Governance

> **Authority:** Repository ruleset configuration for `master`, stable required
> checks, and the read-only drift-audit procedure.
>
> **Maintenance:** Update this document and
> [`.github/master-branch-ruleset.json`](../.github/master-branch-ruleset.json)
> together whenever the default branch, required checks, or review policy
> changes. Apply and then audit the corresponding GitHub configuration.

## Scope and source of truth

The canonical repository is `matejkadlec/league-analysis`; its default branch is
`master`. GitHub hosts the active repository ruleset, while the tracked
[`master-branch-ruleset.json`](../.github/master-branch-ruleset.json) is the
reviewable desired state. The desired state contains no credentials or bypass
actors.

The active ruleset is named **Protect master with verified PR delivery** and
targets only `refs/heads/master`. It requires:

- changes to enter `master` through a pull request;
- resolution of all review conversations;
- stale review approvals to be dismissed after a reviewable push;
- no required approving-review count or last-push approval, preserving the
  workflow without inventing a second reviewer;
- all supported merge methods (`merge`, `squash`, and `rebase`);
- the required checks **Deterministic full-project gate** and **Live production dependency audit**, each bound to the GitHub Actions integration;
- strict required checks, so a pull request must be current with `master`;
- no bypass actors, no force pushes, and no branch deletion.

Signed commits are deliberately not required: the repository has no shared
verified-signature workflow for Codex or dependency automation. Revisit that
decision only after a compatible signing and recovery process is documented.

The two required check contexts are the stable job names in
[`quality-checks.yml`](../.github/workflows/quality-checks.yml). They cover the
deterministic quality, security, migration, workflow, and repository-tooling
checks plus the live production dependency comparison. Since LGA-10 landed the
production Docker artifacts, the deterministic full-project gate also builds
and health-checks the isolated production containers; Docker checks are part
of that stable context, not a separate required context.

## Current verified state

On 2026-08-03, the baseline desired state was applied as GitHub ruleset
[`20327717`](https://github.com/matejkadlec/league-analysis/rules/20327717).
The read-only audit passed against its `master` scope and the two required
contexts. The tracked integration binding is applied through the owner-approved
post-merge administration step below, then verified by the read-only audit.
Disposable PR [#10](https://github.com/matejkadlec/league-analysis/pull/10)
then confirmed that GitHub rejected an early merge, direct push, force push, and
default-branch deletion; the PR was closed and its temporary branch deleted.

## Safe delivery policy

Dependabot and authorized automation may create branches and pull requests, but
they have no ruleset bypass. The ruleset blocks direct updates, force pushes,
and deletion of `master`, but its zero-review configuration cannot distinguish
the owner from any credential permitted to perform a normal pull-request merge.
Owner-managed review and merging are therefore a repository workflow policy:
automation must not merge without explicit owner authorization.

Do not add a bypass actor for convenience. A documented emergency exception
requires explicit owner approval, the narrowest possible actor and
`pull_request`-only mode, and a follow-up removal/audit. Repository writers
must not weaken this ruleset; only an owner-approved administration change may
alter the reviewed desired state.

## Audit and change procedure

After authenticating `gh` to the canonical repository, run the read-only audit:

```bash
python3 scripts/verify-github-ruleset.py
```

The command verifies that `master` remains the default branch, compares GitHub's
active ruleset with the checked-in desired state, and rejects any additional
active branch ruleset that also applies to `master`. It fails on
missing/duplicate rulesets, target/enforcement/bypass drift, changed review
settings, check-context drift, or an incorrect check integration. It needs
GitHub API read access but never changes repository configuration.

For an intentional policy change:

1. Update the JSON desired state, this document, and the relevant quality-check
   documentation in one pull request.
2. Validate the tracked configuration without contacting GitHub:

   ```bash
   python3 scripts/verify-github-ruleset.py --config-only
   ```

3. Replace a required context in four releases: first merge a workflow change
   that emits both old and new contexts while the ruleset still requires the
   old one. Next, merge the desired-state change requiring both contexts, then
   make the owner-approved live ruleset change and audit it. Third, merge the
   desired-state removal of the old context while keeping both workflow jobs.
   Only after that merge may the owner remove the old live requirement; a final
   release may then remove the old workflow job. This order prevents a
   required-check deadlock.
4. For any other policy change, after the pull request is merged, make the
   owner-approved GitHub administration update (including the GitHub Actions
   integration binding) and rerun the read-only audit.
5. Record the verified ruleset URL/ID and required contexts in the associated
   LGA issue. Never put access tokens or configuration secrets in the issue.

The GitHub REST ruleset API requires repository administration permission for a
write, so an unavailable or insufficiently authorized administrator is an owner
boundary rather than a reason to weaken the policy.
