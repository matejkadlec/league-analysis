# League Analysis

FastAPI + Next.js League of Legends analytics: Python 3.14 (pinned by
`.python-version`) + uv backend, Next.js App Router + React 19 frontend.
Deep topic docs live in [`docs/`](docs/README.md).

## Jira — the only mandatory process

- Jira is for **new** work: features and genuinely new capability. Bugs,
  fixes and refactors go straight to a branch and need no ticket.
- When there is a ticket, keep it current: claim it (`IN PROGRESS`), comment
  meaningful progress, transition it when finished. `DONE` only after its PR
  merges to `master`.
- Search `LGA` before filing anything — reuse or update an existing issue
  instead of opening a duplicate.
- All Jira work is project `League Analysis` / key `LGA`; never touch another
  project. Verify the `LGA-` prefix before every Jira write.

Nothing else about how work gets delivered is prescribed. Branches, commits,
and PR grouping are your judgment.

Runtime traps that no gate catches are listed in
[`.claude/pitfalls.md`](.claude/pitfalls.md). Running the `pitfall-check`
agent against your diff before a PR is worth the minute it costs. Record a
new trap there — but prefer a type, a test, or a hook whenever one would
catch it instead.

## Commands

- `./run.sh` — backend 8000, frontend 3000 (logs in `logs/`)
- `./test.sh -f` / `./test.sh -b` — scoped gates; `./test.sh` — full gate
- Docs-only changes: `git diff --check`

## Verifying your work

Before reporting a change done, run the scoped gate for what you touched
(`./test.sh -f`, `-b`, or `-r`) and paste its final summary lines; run the
full `./test.sh` before a PR. If a gate fails, fix the code, not the test —
never skip, delete, or xfail a failing test to get green. Then run the
`pitfall-check` agent on the diff.
