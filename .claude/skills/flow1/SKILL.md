---
name: flow1
description: Autonomously select and deliver a coherent batch of 1-N tickets from the active LGA Jira sprint (NEXT first, then TO DO), pulling unfinished dependencies into the batch and keeping NEXT filled by priority. Claims the tickets, implements the batch in its own git worktree and validates it. An AI-only batch is published as one ready pull request and carried through its independent review to its merge and deploy with finalize-pr; a Visual batch is pushed without a pull request and handed to Matěj for a visual review, which he answers with qa1 or qa2. Never implements decision tickets or tickets waiting on Matěj; leaves them to him instead. Takes an optional run location: "flow1 cloud" (the default) selects only work a cloud session can do and stops when none is left; "flow1 local" selects work only a local session can do first, then goes by normal priority. Use when the user says "flow1", "flow1 cloud" or "flow1 local", or asks the agent to pick up and deliver sprint work.
---

# flow1: autonomous batch delivery

Follow `CLAUDE.md` (which imports `AGENTS.md`) and read
[`docs/ai-development-flow.md`](../../../docs/ai-development-flow.md) completely
before selecting work; this skill may not weaken either. Each step names the
section of that document that holds its rules.

`flow1` is one autonomous goal. Do not treat it as a request for a single
ticket, and do not stop at a report before an AI-only batch's ready pull request
or a Visual batch's handoff exists, unless the run reaches a boundary in
_Concurrency and run boundaries_ first: no startable batch (everything left
waits on Matěj, conflicts with in-flight work or exceeds a cap, or a `cloud` run
finds only local-only work), or a stop for Matěj.

**Run location** (_Run location_): the argument is `cloud` or `local`; `flow1`
without one is `flow1 cloud`, and a cloud session (`CLAUDE_CODE_REMOTE=true`)
always runs as `cloud`. `cloud` selects only cloud-capable tickets and, when
NEXT and TO DO hold none that can start, ends without a claim and lists the
local-only tickets left. `local` selects startable local-only tickets first,
from NEXT and TO DO alike, and falls back to normal priority when there are
none. A `cloud` run never promotes a local-only ticket to keep NEXT filled, and
when it finds a local-only step after its claim, it either splits that part and
its acceptance criteria into its own ticket, which alone gets
`Location: local-only`, or releases the batch with `Location: local-only` on
every ticket (_Run location_). Name the mode in the batch announcement.

1. **Intake:** first run _Reconciling merged tickets_; a ticket that cannot be
   matched never blocks the run. Then follow _Intake and conflict control_:
   inspect the active sprint (NEXT before TO DO), the in-flight tickets, open
   pull requests, branches, worktrees and the main checkout; read every
   candidate, comments included, with the candidate field set from _Reading a
   ticket_; set aside every ticket under _Tickets waiting on Matěj_; skip work
   that overlaps in-flight ownership (an overlap only in a lockfile is none: the
   batch that merges second regenerates it, _Conflict domains_); and check each
   batch's _Conflict domains_ and exclusive areas against the caps in
   _Concurrency and run boundaries_ before selecting.
2. **Dependencies:** resolve every candidate's unfinished dependencies under
   _Dependencies_: pull each one from TO DO, NEXT or the backlog into the batch,
   defer a ticket whose dependency is in flight elsewhere, and defer one whose
   dependency waits on Matěj, without listing the waiting ticket (it says what
   it needs; the batch announcement names the deferred ticket).
3. **Classify** each candidate AI-only or Visual under _QA classification_, and
   local-only or cloud-capable under _Run location_. A batch has one QA mode; a
   pulled-in dependency follows _Dependencies_.
4. **Select and announce** one coherent batch from NEXT under _Priority and the
   Next queue_, _Run location_ and _Batch selection_, which define the only
   promotions from TO DO and how far to fill an AI-only batch. Priority is a
   recommendation. A Visual batch also needs a free visual-review slot; while
   none is free, select AI-only work. The announcement names the tickets, the
   pulled-in dependencies and why the batch has this size.
5. **Claim** every newly selected ticket through the _Atomic intake claim_ (its
   `Location` line included) before writing any implementation, choosing each
   Jira move by its target status (_Transitions_). The batch's one branch and
   worktree are created and pushed at the first claim that holds (_Branches and
   worktrees_) and reused for every later ticket of the batch.
6. **Implement** in that worktree, following `AGENTS.md`, the nearest nested
   `AGENTS.md` files and `CLAUDE.md`. Changes keep the topic documents in
   `docs/` and the nested guides current in the same batch.
7. **Validate** under _Implementation and verification_: focused checks while
   working, then the complete gate through the _Gate queue_
   (`flock "${TMPDIR:-/tmp}/league-analysis-gate.lock" ./test.sh`), or
   `./test.sh -r` for a batch of documentation and agent configuration alone. A
   schema change also updates `backend/alembic/expected-head.txt`; a dependency
   change regenerates its lockfile with its tool. Report only the commands that
   actually ran.
8. **Replenish** NEXT and reassess active-sprint priority before handing off.
9. **AI-only batch: publish** under _Publication_: push, open one ready pull
   request (with its **Merge hold** line when it adds an Alembic revision or
   touches the deploy path), verify that the remote head is your final commit,
   record the `🤖 Claude QA` summary on each ticket, move the tickets to PENDING
   CR, and hand off with the status overview from `CLAUDE.md`.
10. **AI-only batch: review, merge and deploy, always.** Do not end the turn at
    the handoff: in the same run, local or cloud, run
    [`finalize-pr`](../finalize-pr/SKILL.md) on that pull request until it
    merges and its deploy finishes, or it reaches one of its stops (_After
    publication_). A batch is not delivered until its pull request has merged.
11. **Visual batch: hand off and stop** under _Visual review handoff_: push the
    branch and open **no pull request**, record the `🖥️ Visual review handoff`
    on each ticket, move the tickets to PENDING USER QA, keep the branch and the
    worktree, and give the status overview in its manual-test shape (_What to
    test_ with the page, state and viewport, the _Launch commands_, how Matěj
    answers, and Verification with its `Tickets:` line). Stop there: his
    [`qa1`](../qa1/SKILL.md) publishes the batch and carries it to its merge,
    and his [`qa2`](../qa2/SKILL.md) revises it.

The run ends at a boundary in _Concurrency and run boundaries_. Every response
of the run, the last one included, ends with the status overview from
`CLAUDE.md`: no batch ledger, a question for whatever the run cannot go on
without, and Verification last, whose `Tickets:` line names the keys the run
claimed (and why, when they differ from the keys Matěj typed: a split, a
pulled-in dependency). What only needs recording goes into Jira comments. In a
cloud session (`CLAUDE_CODE_REMOTE=true`), _Cloud sessions_ adds what differs
there.
