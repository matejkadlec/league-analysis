# Reusable Workflows

The repository's shared instructions live in [AGENTS.md](AGENTS.md) and the
nearest subtree guide. Optional machine-specific skills and agent settings are
kept locally and excluded from Git.

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
Request owner review for intentional interface changes. Publish only when
explicitly authorized; the owner reviews and merges pull requests.
