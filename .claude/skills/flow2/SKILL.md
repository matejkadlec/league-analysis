---
name: flow2
description: Turn Matěj's task description into LGA Jira tickets in the active sprint (the existing ticket format - a parent epic only when one fits, labels, priority, an "Acceptance criteria" section, English), claim them (IN PROGRESS) and implement them right away through the flow1 lifecycle, pulling in unfinished dependencies (an AI-only batch ends in a merged and deployed pull request, a Visual batch in a visual-review handoff for qa1 or qa2). Takes an optional run location: "flow2 cloud" (the default) delivers only the items a cloud session can do and leaves local-only ones captured but unclaimed; "flow2 local" delivers local-only items first, then the rest. Use when the user describes a task and says "flow2", "flow2 cloud" or "flow2 local".
---

# flow2: capture then deliver

Follow `CLAUDE.md` (which imports `AGENTS.md`) and read
[`docs/ai-development-flow.md`](../../../docs/ai-development-flow.md) completely
before creating or selecting work; this skill may not weaken either.

**Run location** (_Run location_): the argument is `cloud` or `local`; `flow2`
without one is `flow2 cloud`, and a cloud session (`CLAUDE_CODE_REMOTE=true`)
always runs as `cloud`. Both modes capture every requested item as a ticket.
`cloud` claims and delivers only the cloud-capable ones; `local` delivers
local-only items first, then the rest by normal priority. A Riot development
key Matěj pastes for the task goes only into the administrator Settings of the
session's own instance (_Run location_), never into a ticket, a file or a log.

1. Start with _Reconciling merged tickets_, so a ticket whose pull request
   already merged reads as DONE in the duplicate search. Then analyze every
   requested item and search `LGA` for duplicates, reading each candidate,
   comments included, with the candidate field set from _Reading a ticket_.
2. Create or update tickets in the current active sprint under _Issues_: Task
   (Bug only for confirmed broken behavior), a parent epic only when one fits
   (LGA-107 for stabilization, LGA-2 for workflow and tooling, a feature epic
   for its feature), labels, priority, a description in one of the existing
   shapes with an `## Acceptance criteria` section, in English, and a `Blocks`
   link for each dependency. Preserve all explicitly requested work; merge only
   truly trivial duplicates. A comment on an existing ticket may already record
   the scope, correction or rejection that decides between creating, updating
   and merging. Never update a duplicate that is in flight (_In flight_ in the
   flow document): it belongs to another batch, so create a follow-up ticket
   linked to it for the new part, or tell Matěj that the requested work is
   already under way there.
3. Set sprint-relative priority, classify each ticket AI-only or Visual under
   _QA classification_, and local-only or cloud-capable under _Run location_. A
   requested item that is Matěj's own decision gets the `decision` label and
   goes to him as a question in the response, not implemented (_Tickets waiting
   on Matěj_).
4. Route new or newly selected work through TO DO -> NEXT (the `flow2`
   exception in _Priority and the Next queue_ lets it in whatever else NEXT
   holds), replenishing NEXT under the same section. The step 6 claim owns the
   NEXT -> IN PROGRESS move; do not make it here, or the claim's "still in NEXT"
   precondition is false on every run.
5. Inspect in-flight ownership, conflicts and dependencies before implementing,
   exactly as `flow1` steps 1 and 2 do, including the conflict domains, the
   exclusive areas, the pending-batch slots and the visual-review limit (a
   lockfile shared with an in-flight batch holds nothing back: the batch that
   merges second regenerates it). Pull unfinished dependencies into the batch
   under _Dependencies_.
6. Claim every ticket you will implement through the atomic intake claim before
   writing any implementation, as `flow1` step 5 requires. A ticket this run
   just created is claimed the same way; creating it grants no ownership. A
   `cloud` run claims no local-only ticket: it leaves each in NEXT with a
   comment that it waits for a local session, and when no requested item is
   cloud-capable it ends here with the status overview, naming the tickets a
   `flow1 local` or `flow2 local` run delivers.
7. Implement as much of the safe coherent scope as current precision allows,
   then follow `flow1` steps 6 to 11 for validation, the ticket statuses,
   concurrency and the stop rules: an AI-only batch is published and carried to
   its merge and deploy; a Visual batch is pushed without a pull request and
   handed to Matěj (the status overview with its _Launch commands_) for `qa1` or
   `qa2`.
8. Leave blocked tickets in the appropriate non-complete state with the exact
   dependency recorded (a `Blocks` link and a comment).
