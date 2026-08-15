# League Analysis

FastAPI + Next.js League of Legends analytics: Python 3.14 (pinned by
`.python-version`) + uv backend, Next.js App Router + React 19 frontend.
Deep topic docs live in [`docs/`](docs/README.md); workflow skills
(`flow1`, `flow2`, `qa1`, `qa2`) in `.claude/skills/`.

## Jira — the only mandatory process

- All Jira work is project `League Analysis` / key `LGA`; never touch another
  project. Verify the `LGA-` prefix before every Jira write.
- Keep Jira current as you work: claim the issue (`IN PROGRESS`), comment
  meaningful progress, transition it when finished. `DONE` only after its PR
  merges to `master`.
- Intentional visual changes go to `PENDING USER QA` before `PENDING CR`
  (use `qa1`/`qa2`).
- Batching, worktrees, and PR grouping are your judgment — decide them
  yourself.

## Hard safety rules

- Never commit secrets or `.env` contents.
- Schema changes only via reviewed Alembic revisions applied through
  `backend/scripts/migrate.py`; never `Base.metadata.create_all()`, never
  drop/reset a populated schema.
- Leave Riot API rate limiting alone. Stored PUUIDs are encrypted per
  developer account — a cross-account key sees 400s, not data corruption —
  so never auto-merge player rows ([docs/riot-api.md](docs/riot-api.md)).
- Production Pi: target only League Analysis resources and verify their
  Compose labels first ([docs/deployment.md](docs/deployment.md)).
- The LGA-11 local QA fixtures are the only sanctioned test credentials.
- Publish only what the user or a named workflow authorizes; never unsafe
  force push (`--force-with-lease` only).

## Commands

- `git config core.hooksPath .githooks` — once, after clone
- `./run.sh` — backend 8000, frontend 3000 (logs in `logs/`)
- `./test.sh -f` / `./test.sh -b` — scoped gates; `./test.sh` — full gate
  before every PR
- Docs-only changes: `git diff --check`

## Working style

- Keep outputs concise. Make routine judgment calls yourself; flag concerns in
  one sentence instead of asking.
- The gates and pre-commit hooks enforce quality — add no extra verification
  passes beyond them.
- Use subagents only for large, independent, parallelizable work.
- Explicit imports, no wildcard imports, no stream-of-consciousness comments.
- Runtime behavior changes update the matching authoritative doc in the same
  task (see [docs/CLAUDE.md](docs/CLAUDE.md) for the trigger).
- When editing a subtree, follow the nearest `CLAUDE.md` there.
