# League Analysis — Agent Guide

## Project

League Analysis is a League of Legends analytics application and portfolio
project. Development is paused. The canonical repository is
`matejkadlec/league-analysis`, with `master` as its default branch. The owner
runs one private, login-only installation at <https://league.matejkadlec.cz>;
everyone else runs it locally.

Read the nearest `AGENTS.md` before changing a subtree. Public project copy
belongs in [README.md](README.md); technical documentation is indexed in
[docs/README.md](docs/README.md). [SKILLS.md](SKILLS.md) describes reusable
workflows. The shared Claude Code configuration is versioned: [CLAUDE.md](CLAUDE.md)
(which imports this guide), the delivery skills, the reviewer agent and the
hooks in `.claude/`, and the Jira server in `.mcp.json`. Personal and
machine-specific agent configuration (`.agents/`, `.codex/`,
`.claude/settings.local.json`) stays outside version control.

## Working safely

- Preserve unrelated changes, branches, and worktrees.
- Never commit passwords, tokens, API keys, environment files, database exports,
  or private logs. Use `.env.example` for configuration names and placeholders.
- Keep the documented local QA fixtures local. Do not change arbitrary users
  or reset populated databases as part of testing.
- Reviewed Alembic revisions in `backend/alembic/versions/` own the schema.
  Apply them through `backend/scripts/migrate.py`; never use
  `Base.metadata.create_all()`, drop populated schemas, or stamp over an
  unexplained migration mismatch.
- Do not change Riot rate limiting unless explicitly requested. Stored PUUIDs
  are bound to a Riot developer account; changing that account requires a data
  migration. Never merge player rows automatically.
- Keep explicit imports, feature boundaries, and concise code comments.
- Update authoritative documentation when changing a durable behavior or
  operating procedure. Keep mechanical details in code.

## Local commands

```bash
./run.sh                 # Interface on 3000, API on 8000
./run.sh 3001 8001       # Alternate ports
./test.sh -f             # Frontend and repository checks
./test.sh -b             # Backend and repository checks
./test.sh                # Complete quality gate
```

The launcher stops listeners on the selected ports and applies reviewed
migrations before starting the application. Do not restart an existing session
unnecessarily. Read both `logs/backend.log` and `logs/frontend.log` when
investigating local runtime failures. Configuration changes require a restart.

## Delivery

Run checks proportional to the change, and the complete gate before publishing
a pull request. Let pre-commit hooks run. Report test results and limitations
accurately; local validation is distinct from GitHub CI and owner approval.
Intentional interface changes require owner visual review before publication.

A merge to `master` deploys to production once the Quality Checks workflow
passes; [docs/deployment.md](docs/deployment.md) is the authority for the
stack, the host and its procedures. Production shares its server with other
sites: change only what that document lists as this project's, and ask the
owner before anything host-wide. Never print production configuration, never
remove the PostgreSQL volume, and never create accounts there except through
the documented account command.

Do not commit or push without authorization, push task changes directly to
`master`, bypass hooks, or use an unsafe force push. Jira work targets only
project `LGA`; keep the issue current, and mark it done only after its pull
request is merged.

Agent delivery follows [docs/ai-development-flow.md](docs/ai-development-flow.md)
through the `flow1`, `flow2`, `qa1`, `qa2` and `finalize-pr` skills. Starting
one of them authorizes its commits, pushes, pull requests and Jira updates. A
change the owner should see is pushed for his visual review before any pull
request opens. An AI-only pull request is merged by `finalize-pr` once an
independent review of its exact head is clean and every check is green; a pull
request that adds an Alembic revision or changes the deploy path or production
configuration waits for the owner's approval of that head before it merges.
Outside such a run, do not merge or continue modifying a published pull request
without an explicit request, and never bypass the `master` ruleset.
