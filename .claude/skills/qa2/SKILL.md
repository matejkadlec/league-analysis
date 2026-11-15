---
name: qa2
description: Record Matěj's failed visual review of a batch in PENDING USER QA and revise the same branch for another review, without opening a pull request. Only Visual batches use it. Use when the user says "qa2" or reports problems from a visual review.
---

# qa2: changes required, revise

Follow `CLAUDE.md` (which imports `AGENTS.md`) and read
[`docs/ai-development-flow.md`](../../../docs/ai-development-flow.md) completely
before revising; this skill may not weaken either. _qa2: changes required_ there
holds the rules.

1. **Find the batch** as `qa1` does: the one this session handed off, the keys,
   branch or pull request Matěj names, or the only batch waiting for a visual
   review (its tickets in PENDING USER QA, with or without a pull request); with
   several and no hint, ask which one. Read his feedback first: what changes the
   plan or needs his decision goes back to him as a question in the response,
   and its tickets stay in PENDING USER QA with the open question in a comment.
   Then move only the tickets whose feedback this revision fixes from PENDING
   USER QA to IN PROGRESS (the transition whose target is IN PROGRESS,
   _Transitions_).
2. **Stay on the same branch:** no new branch and no replacement work. Reuse its
   worktree or create one from `origin/<branch>` after `git fetch origin`. Then
   bring the local branch up to `origin/<branch>` before anything else:
   `git merge --ff-only origin/<branch>`, or `git merge origin/<branch>` when
   both sides have commits. Commits Matěj pushed from his own clone belong to the
   batch and are never pushed over; every later push is leased on that fetched
   head (`--force-with-lease=<branch>:<sha>`). Read the affected tickets'
   comments for context the handoff did not repeat (_Reading a ticket_).
3. **Apply his feedback**, and nothing beyond it (feedback that needs his
   decision was set aside in step 1).
4. **Check and commit:** the affected checks and the complete gate through the
   _Gate queue_ (_Implementation and verification_), then commit.
5. **Push** the revision (`--force-with-lease` after a rebase) and read the
   remote head back. Open no pull request. A batch whose pull request waits for a
   reconfirmation (_Reconfirmation_) gets the new head on that pull request, and
   its `finalize-pr` run carries on (the new head gets its review pass). Such a
   `qa2` belongs in the session whose `finalize-pr` run owns the pull request; in
   any other session, ask Matěj first whether that run has stopped, as `qa1`
   does.
6. **Record and move:** on each affected ticket, a new
   `🖥️ Visual review handoff` for the revision (what changed, the new head, a
   What to test limited to it), which makes the new head the one Matěj reviews
   next; then move the tickets back to PENDING USER QA. The batch keeps its
   visual-review slot through the revision.
7. **Hand back** with the status overview from `CLAUDE.md` in its manual-test
   shape: _What to test_ limited to what the revision changed (page, state,
   viewport), the whole block that switches Matěj's clone to the branch, updates
   it and starts the application (_Launch commands_: `cd`, `git fetch origin`,
   `git switch <branch>`, `git pull --ff-only`, then `./run.sh`; never the
   update command alone; when this revision rebased the branch, so
   `git merge-base --is-ancestor <the head he last ran> origin/<branch>` fails,
   `git reset --keep origin/<branch>` and `git rev-parse --short HEAD` replace
   `git pull --ff-only`: _Launch commands_, "A rewritten branch"; plus the
   install line when the revision changed `.nvmrc` or
   `frontend/package-lock.json`), how he answers (`qa1`, `qa2`), and
   Verification with its `Tickets:` line. Then wait for his next answer.
