# League Analysis — Agent Guide

## Project

League Analysis is a local League of Legends analytics application and portfolio
project. Development is paused. The canonical repository is
`matejkadlec/league-analysis`, with `master` as its default branch.

Read the nearest `AGENTS.md` before changing a subtree. Public project copy
belongs in [README.md](README.md); technical documentation is indexed in
[docs/README.md](docs/README.md). [SKILLS.md](SKILLS.md) describes reusable local
workflows. Machine-specific agent configuration stays outside version control.

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

Do not commit or push without authorization, push task changes directly to
`master`, bypass hooks, or use an unsafe force push. Published pull requests
are ready for owner review; do not merge or continue modifying them without
an explicit request. If Jira is used, target only project `LGA`, keep the issue
current, and mark it done only after its pull request is merged.
