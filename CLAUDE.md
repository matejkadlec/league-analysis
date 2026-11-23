@AGENTS.md

# League Analysis: Claude Code guide

[`AGENTS.md`](AGENTS.md), imported above, is the shared guide for every agent
and comes first. This file adds what Claude Code sessions need on top of it: the
delivery skills, git practice for parallel sessions, and the status overview
that ends every response. The rules of the delivery flow live in
[docs/ai-development-flow.md](docs/ai-development-flow.md).

- **Owner:** Matěj. Agents do most of the implementation; he sets direction,
  plans in Jira, reviews visible changes and approves merges that touch the
  production schema or deploy path. **Communicate in English** in the
  repository, Jira and pull requests. Every response to him ends with the
  [status overview](#status-overview).

## Delivery skills

The skills live in [`.claude/skills/`](.claude/skills/) and take the rules from
[docs/ai-development-flow.md](docs/ai-development-flow.md):

| Shortcut | What it does |
| --- | --- |
| `flow1` [`cloud`\|`local`] | Takes a batch of active-sprint LGA tickets (NEXT first, then TO DO) and delivers it |
| `flow2` [`cloud`\|`local`] | Turns Matěj's task description into LGA tickets and delivers them the same way |
| `qa1` | Matěj passed a visual review: publish the batch and carry it to its merge |
| `qa2` | Matěj asks for changes after a visual review: revise the same branch and hand it back |
| `finalize-pr <n>` | Independent review, fixes, merge, and the CI and deploy that follow |

An AI-only batch ends in one ready pull request that `finalize-pr` merges; a
Visual batch ends in a pushed branch, without a pull request, for Matěj's
review. The independent reviewer is [`.claude/agents/pr-reviewer.md`](.claude/agents/pr-reviewer.md).

## Commands

```bash
./run.sh                                                    # interface on 3000, API on 8000
flock "${TMPDIR:-/tmp}/league-analysis-gate.lock" ./test.sh # complete gate, queued
flock "${TMPDIR:-/tmp}/league-analysis-gate.lock" ./test.sh -f
./test.sh -b                                                # backend, no lock needed
./test.sh -r                                                # documentation and configuration only
```

Two frontend gates on one machine collide on the Playwright server's port, so
agents queue them ([flow: Gate queue](docs/ai-development-flow.md#gate-queue)).
The complete gate takes several minutes: run it in the background and follow its
output. In a cloud session the SessionStart hook runs
`.claude/hooks/cloud-up.sh` in the background: the Git hooks, the pinned Node
and Playwright Chromium, and the environment's `lga-cloud-up` (PostgreSQL 18,
`uv sync`, `npm ci`, `.env`), all under one lock. A session that needs the setup
first runs that script, never a bare `lga-cloud-up`, and reads
`logs/lga-cloud-up.log`; before running `npm` or `npx` by hand,
`source tools/use-project-node.sh`
([flow: Cloud sessions](docs/ai-development-flow.md#cloud-sessions)).

## Git and branches

**Branches**

- **Never commit or push to `master`.** Every change reaches it through a pull
  request, and every merge deploys to production. A local commit on `master` is
  still a mistake: undo it (below), never push it.
- **Start every task from a fresh `origin/master`:**
  `git fetch origin && git switch -c <type>/<slug> origin/master`. `<type>` is
  the Conventional Commits type of the main change (`feat`, `fix`, `docs`,
  `build`, `ci`, `test`, `chore`, `refactor`); `<slug>` is two to five
  kebab-case words. A Jira batch puts its ticket keys before the slug, e.g.
  `fix/lga-108-match-history-fit`
  ([flow](docs/ai-development-flow.md#branches-and-worktrees)).
- A session that Claude Code already put on its own branch or worktree (the
  desktop app's `claude/<name>` branches, a cloud session's clone) works there
  and creates no other.
- Before creating a branch, look for existing work on the same task
  (`git branch -a`, `git worktree list`, open pull requests) and continue it
  instead of starting a parallel one. Never commit to another session's branch
  unless Matěj asks.
- Run `git status` before switching branches. Never switch, reset, stash or
  clean a checkout that holds uncommitted changes you did not make: they belong
  to Matěj or another session, so use a worktree instead.
- Matěj's own uncommitted edits that belong to the task (small manual polish):
  fold them into the next relevant commit. Ask first when they look large,
  risky, generated or unrelated. Never discard them.
- Committed to the local `master` by mistake: `git branch <type>/<slug>` (keeps
  the commits; confirm with `git log`), `git switch <type>/<slug>`,
  `git branch -f master origin/master`. Never `reset --hard` for this.

**Commits and pushes**

- Stage explicit paths and read `git diff --staged` before each commit. Never
  commit `.env` files, logs, database dumps, build output or a Riot key.
- Small, coherent commits with Conventional Commits messages. Let the
  pre-commit hooks run; never `--no-verify`.
- Before every push, check that `git remote get-url origin` points to
  `matejkadlec/league-analysis`. Push only your own branch:
  `git push -u origin <branch>`.
- Force-push only your own branch, only with `--force-with-lease`, and only to
  replace commits nobody else has built on. Never force-push `master`.
- When `master` has moved on and conflicts, rebase your own branch onto
  `origin/master`. On a branch someone else created or shares, or one Matěj has
  reviewed, merge `origin/master` in instead.
- Never discard work you did not create: no `git reset --hard`, `git clean`,
  `git checkout -- <path>`, `git restore` or `git stash drop` on it.

**Worktrees**

- One session at a time: a branch in the main checkout is enough. Use a
  worktree when the main checkout is busy (another session works there, it
  holds uncommitted changes, or you run tasks in parallel). `flow1` and `flow2`
  always work in their own worktree, and their parallel batches are capped
  ([flow](docs/ai-development-flow.md#concurrency-and-run-boundaries)).
- Location: `../league-analysis-worktrees/<branch with "/" replaced by "-">`,
  outside the repository. New branch:
  `git worktree add -b <branch> ../league-analysis-worktrees/<dir> origin/master`.
  Existing branch: `git worktree add ../league-analysis-worktrees/<dir> <branch>`;
  a branch lives in only one worktree, so reuse the one `git worktree list`
  shows.
- A new worktree has no `.env`: copy that one file from the main checkout when
  the task needs the application, and nothing else
  ([Project Overview](docs/project-overview.md#git-hooks-and-worktrees)).
- Work only inside the worktree: run every command, check and commit there.
- After the merge, remove only what your session created:
  `git fetch --prune origin`, `git worktree remove <path>` (never `--force` over
  uncommitted changes), `git branch -d <branch>`, `git worktree prune`. GitHub
  deletes the merged head branch (`delete_branch_on_merge`).
- Claude Code's own session worktrees live in `.claude/worktrees/` (ignored).

**Pull requests**

- Open them ready for review (never drafts) against `master`. The description
  says what changed, why, and which checks passed.
- Work Matěj should see is reviewed before its pull request exists: push the
  branch, tell him what to look at and how, and stop. His `qa1` opens the pull
  request and `finalize-pr` follows; his `qa2` with changes gets them made and a
  new handoff
  ([flow: Visual review handoff](docs/ai-development-flow.md#visual-review-handoff)).
  Work that needs no visual review gets its pull request straight away. Pull
  requests carry no GitHub labels.
- A pull request from a Jira batch names its tickets in the title, e.g.
  `fix(match-history): fit rows at 1920×1080 (LGA-108)`.
- After publishing or updating a ready pull request as your own task work, run
  `finalize-pr <n>` on it straight after, in the same run, in every case. Its
  fresh `pr-reviewer` subagent is the only code review, and it carries the pull
  request to its merge and through the deploy.
- A pull request that adds an Alembic revision or changes the deploy path or
  production configuration stops before its merge until Matěj approves it
  ([flow: Publication](docs/ai-development-flow.md#publication)).
- Never merge with `--admin`, never enable auto-merge, and never bypass the
  ruleset ([GitHub Branch Governance](docs/github-governance.md)).
- Renaming the CI job `Deterministic full-project gate` breaks the merge gate:
  the ruleset requires it by name.

**Ending a session**

- Stop every process you started (`./run.sh`, a dev server, a gate), remove your
  temporary files, and record any uncommitted work you leave behind in a comment
  on the ticket it belongs to.

## Status overview

Every response to Matěj ends with a status overview, so he sees what the run
needs from him and what it proved without scrolling back. It has no batch
ledger: no "Merged into master", "Pending CR", "Pending User QA" or "Blocked or
other" group, and no Cleanup line. Claude Code shows him the sessions that wait
for him, and what a ledger only recorded (blocked and decision tickets, stale or
lost claims, follow-ups, reconciled tickets) lives in Jira comments. Ticket keys
and pull request links, plus the visible or architectural changes that matter;
files, implementation detail and the full evidence stay in the ticket comments.
It comes in one of two shapes, and both end with Verification.

**Something waits for Matěj's manual check** (a visual review, a revision of
one, anything he should see before it merges). Four parts:

1. **What to test:** one sentence on where to start (the page and the account),
   then a numbered list. Each item opens with a bold name for the check, gives
   the page, the state, the viewport and the steps as sub-bullets, and says what
   he should see. A behavior change he must decide on comes first and says so
   ([flow: What to test](docs/ai-development-flow.md#what-to-test),
   [Reaching the state](docs/ai-development-flow.md#reaching-the-state)).
2. **Launch commands:** complete commands he can paste, in one block, with the
   clone named in the heading, e.g. "Launch commands (your WSL clone)"
   ([flow: Launch commands](docs/ai-development-flow.md#launch-commands)).
   Always the whole block, a revision's too: `cd ~/projects/league-analysis`,
   `git fetch origin`, `git switch <branch>`, `git pull --ff-only`, then
   `./run.sh`, one per line; never the update command alone, as his clone is
   often on another branch by the time he looks. When the branch was rewritten
   since the head he last ran (`git merge-base --is-ancestor <reviewed head>
   origin/<branch>` fails), `git reset --keep origin/<branch>` and
   `git rev-parse --short HEAD` take the place of `git pull --ff-only`. A branch
   that changes `.nvmrc` or `frontend/package-lock.json` adds its install line
   before `./run.sh`, and one that adds an Alembic revision says that his local
   database will be upgraded. Then the URL to open.
3. **How he answers**, in one line. For a first review, in this session or any
   later one: `qa1` passes it (the batch is then published), `qa2` with what is
   wrong asks for a revision. For a reconfirmation of a published pull request,
   in this session, whose `finalize-pr` run owns it: `qa1` passes it (the run
   continues to the merge), `qa2` asks for a revision.
4. **Verification ✅** (below).

**Nothing waits for his check.** The response says in a few lines what the run
did: a merged pull request with its link, its merge commit, the deploy result
and the changes that matter, or where a pull request stands and why. Then
**Verification ✅**.

In both shapes, whatever the run cannot go on without (a decision, a merge hold,
an account, a conflict only he can settle) is asked as a question before
Verification, one he can answer in a reply. Nothing else is listed for him.

**Verification ✅** closes every response: what ran and passed in this run, one
bullet each (the gate's commands, the review passes and what they found, CI on
the head or on `master` after the merge, the Deploy run); never "all checks
passed" for a partial run, and "nothing ran" when nothing did. Its last line,
the last line of the response, names the tickets this run claimed or worked on,
such as `Tickets: LGA-108, LGA-109`, or `Tickets: none`. When they differ from
the keys Matěj typed, a few words say why (a ticket split, a dependency pulled
in, a part split off).
