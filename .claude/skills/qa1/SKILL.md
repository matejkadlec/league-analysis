---
name: qa1
description: Record Matěj's passed visual review of a batch in PENDING USER QA, publish its preserved branch as one ready pull request, move its tickets to PENDING CR and carry the pull request through its independent review to its merge and deploy with finalize-pr. Also confirms a reconfirmation on a published pull request. Only Visual batches use it. Use when the user says "qa1" or approves a visual review.
---

# qa1: visual review passed, publish

Follow `CLAUDE.md` (which imports `AGENTS.md`) and read
[`docs/ai-development-flow.md`](../../../docs/ai-development-flow.md) completely
before publishing; this skill may not weaken either. _qa1: visual review
passed_ there holds the rules.

1. **Find the batch** Matěj passed: the one this session handed off, the ticket
   keys, branch or pull request he names, or the only batch waiting for a visual
   review (its tickets in PENDING USER QA, with or without a pull request). With
   several and no hint, ask which one, listing each with its tickets, branch or
   pull request. Nothing waiting for a review: say so and stop. When a `qa2`
   left a decision question open on the batch's tickets, ask Matěj to answer it
   first, or to confirm that his `qa1` accepts the batch as it is; publish
   nothing before that. A ticket from before this flow whose comments name no
   branch is not guessed at: ask him which branch or pull request holds it.
2. **Take the preserved branch:** `git fetch origin`, then reuse the worktree
   that holds it or create one from `origin/<branch>` (_Branches and
   worktrees_). Then bring the local branch up to `origin/<branch>` before
   anything else: `git merge --ff-only origin/<branch>`, or
   `git merge origin/<branch>` when both sides have commits. Commits Matěj
   pushed from his own clone belong to the batch and are never pushed over;
   every later push is leased on that fetched head
   (`--force-with-lease=<branch>:<sha>`). His uncommitted edits follow
   `CLAUDE.md`: fold small ones that belong to the batch into the next commit,
   and ask about anything larger. Anything after the handed-off head that
   changes what he sees (his edits, his pushed commits) was reviewed only if he
   says so in his `qa1`; otherwise it goes back to him for another review, as
   `qa2` does, instead of being published.
3. **Finish:** commit the coherent batch. When `origin/master` moved (for a
   stacked batch: its dependency branch), rebase onto it, regenerate a shared
   lockfile with its tool (`uv lock`, `npm install --package-lock-only`), and
   move a new Alembic revision's `down_revision` and
   `backend/alembic/expected-head.txt` onto the new head when `master` gained a
   revision (_Conflict domains_). Whenever the head differs from the handed-off
   head the gate last passed on (his commits or edits, a rebase), run the
   complete gate again through the _Gate queue_ (_Implementation and
   verification_). A rebase whose conflict resolutions touch anything he sees
   (_QA classification_) changes what he reviewed: push it and hand it back for
   another review, as `qa2` does, instead of publishing.
4. **Publish** under _Publication_: push (leased as in step 2), open one ready
   pull request to `master` (a stacked batch: to its dependency branch, until
   that merges), and read the remote head back: it must be your final commit.
   The description carries the line
   `Visual review passed: reviewed <sha>, published <sha>`, the GitHub-side
   record `finalize-pr` falls back on when a Jira write fails, and the **Merge
   hold** line when the pull request adds an Alembic revision or touches the
   deploy path.
5. **Record and move:** on each ticket, the `🖥️ Visual review passed` (the
   reviewed head, the head it is published as, Matěj's words if he gave any) and
   the `🤖 Claude QA` summary (what was verified, the pull request, the head);
   then move every ticket of the batch from PENDING USER QA to PENDING CR (the
   transition whose target is PENDING CR, _Transitions_). Never leave a passed
   ticket in PENDING USER QA.
6. **Hand off and monitor:** the status overview from `CLAUDE.md`, then in the
   same run, local or cloud, [`finalize-pr`](../finalize-pr/SKILL.md) on the
   pull request until it merges and deploys or reaches one of its stops. The
   visual review was Matěj's last required step, unless the pull request carries
   a merge hold. This session has taken the batch over: its worktree and local
   branch count as created by this session, so `finalize-pr` removes them after
   the merge.

**A pull request that waits for a reconfirmation** (_Reconfirmation_): `qa1`
publishes nothing new. It passes only the head Matěj reviewed, the one the
latest `🖥️ Visual review handoff` names: when the pull request moved on since
then and the new commits change what he sees (_QA classification_), it hands
those back for another review instead. Otherwise it first rewrites the pull
request description's `Visual review passed: reviewed <sha>, published <sha>`
line to name that head
(`gh api -X PATCH repos/matejkadlec/league-analysis/pulls/<n> -F body=@<file>`),
the record that survives a failed Jira write, then records the
`🖥️ Visual review passed` for that head on each ticket, moves the tickets to
PENDING CR, and the `finalize-pr` run continues to the merge. One `finalize-pr`
run owns a pull request: when the answer comes in the session whose run waits
for this review, that run carries on. In any other session, ask Matěj first
whether that run has stopped; only then does `qa1` continue `finalize-pr` here,
and otherwise it changes nothing and points him to the waiting session.
