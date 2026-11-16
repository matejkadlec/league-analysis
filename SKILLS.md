# Reusable Workflows

The repository's shared instructions live in [AGENTS.md](AGENTS.md) and the
nearest subtree guide. Claude Code sessions also read [CLAUDE.md](CLAUDE.md),
which imports `AGENTS.md`. Personal and machine-specific agent settings stay
local and are excluded from Git.

## Deliver Jira work

The delivery skills live in [`.claude/skills/`](.claude/skills/) and take every
rule from [ai-development-flow.md](docs/ai-development-flow.md):

- `flow1` [`cloud`|`local`]: take a batch of active-sprint `LGA` tickets and
  deliver it.
- `flow2` [`cloud`|`local`]: turn a task description into `LGA` tickets and
  deliver them.
- `qa1` / `qa2`: the owner's answer to a visual review: publish the batch, or
  revise it.
- `finalize-pr <n>`: the independent review by the read-only
  [`pr-reviewer`](.claude/agents/pr-reviewer.md), the merge, and the CI and
  deploy that follow.

## Change an existing feature

Read the relevant guide, preserve unrelated work, implement a focused change,
and update the matching technical document when a durable behavior changes.
Run the relevant checks described in [quality-checks.md](docs/quality-checks.md).

## Update the database

Create a reviewed Alembic revision and update the expected head. Validate it
against a disposable database before applying it to an existing local database
through the locked migration runner. See [database.md](docs/database.md).

## Review and publication

Review the diff, check for secrets and private data, and run the complete gate.
Changes the owner should see get his visual review before a pull request opens.
Pull requests from the delivery skills merge through `finalize-pr`; a pull
request that adds an Alembic revision or changes the deploy path waits for the
owner's approval before its merge. Any other publication or merge needs his
explicit authorization.
