# Documentation Instructions (`docs/`)

> **Scope:** Maintained documentation under `docs/`, including architecture,
> workflows, schema explanations, integrations, and testing decisions.
>
> **Maintenance:** Update this guide when documentation ownership, validation,
> or the topic map changes.

The repository identity, safety boundaries, and development lifecycle in
[`../AGENTS.md`](../AGENTS.md) apply here and cannot be weakened by a topic
document.

## Authority and Ownership

- `docs/` is the consolidated source for architecture, workflow, schema,
  integration, and testing documentation.
- Jira project `LGA` is the task and planning source of truth. Durable technical
  decisions belong in the appropriate document, not only in a Jira comment.
- [`README.md`](README.md) is the documentation index and records which file is
  authoritative for each topic.
- Prefer updating one authoritative topic document over copying the same
  decision into several guides.
- Topic documents may add project-specific detail but may not weaken
  repository-wide workflow, identity, or safety rules.

## Required Co-Updates

Topic documents record durable invariants, rationale, external-system and
production facts, and operational procedures — they do not mirror code.
Mechanical facts (schema columns, endpoint lists, module inventories, route
tables, code flow narration) live in the code and its authoritative sources;
do not add them to a topic document, and do not reintroduce deleted mirrors.

- Update the matching topic document in the same task **only when** the change
  alters a durable invariant, a decision's rationale, an externally observed
  provider/production fact, or an operational procedure the document records.
  A code change that leaves those unchanged requires no documentation edit.
- Schema or SQLAlchemy model changes always add a reviewed Alembic revision
  under `../backend/alembic/versions/` (the schema authority) and apply it
  through `../backend/scripts/migrate.py`; never bypass the advisory-lock
  migration path or reset a populated schema. Update
  [`database.md`](database.md) only when a durable data invariant or procedure
  changes with it.
- Riot integration changes update [`riot-api.md`](riot-api.md) when they touch
  routing rules, credential precedence/health, rate-limit behavior, or an
  externally observed provider contract fact.
- Job-system changes update [`jobs.md`](jobs.md) when they touch a lifecycle
  invariant, recovery contract, interlock, or failure-classification rule.
- Cookie/storage behavior changes update
  [`cookie-consent-compliance.md`](cookie-consent-compliance.md), the applicable
  policy UI, and [`../backend/COOKIE_CONSENT_AGENTS.md`](../backend/COOKIE_CONSENT_AGENTS.md).
- Documents frozen as historical snapshots (dated reviews and audits) are never
  updated to reflect current state; add a supersession note at most.
- Date externally observed facts and cite their source so a reader knows when
  re-verification is due.
- Add a new topic file only when it has a distinct maintained scope. Add it to
  [`README.md`](README.md) in the same change.

## Writing and Links

- Describe the current repository and use paths, routes, package managers, and
  commands verified in the tree.
- Distinguish authoritative source files from explanatory documentation.
- Use relative links for repository files and ensure every linked target exists.
- Keep public project copy in the root [`README.md`](../README.md); keep
  engineering detail here.

## Verification

Documentation-only changes require:

```bash
git diff --check
```

Also review Markdown headings, tables, code fences, relative links, instruction
precedence, and repository/project identifiers manually. Changes tied to
runtime behavior additionally require the checks listed in
[`project-overview.md`](project-overview.md#quality-and-verification).
