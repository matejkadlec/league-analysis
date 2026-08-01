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

- Runtime behavior changes update the matching topic document in the same task.
- Schema or SQLAlchemy model changes update `../backend/init_database.sql` and
  [`database.md`](database.md) together, then apply an incremental `psql`
  migration when the local database must be synchronized.
- Riot API endpoint, routing, credential, or throttling changes update
  [`riot-api.md`](riot-api.md).
- Job configuration, scheduler, lifecycle, API, or control changes update
  [`jobs.md`](jobs.md).
- Cookie/storage behavior changes update
  [`cookie-consent-compliance.md`](cookie-consent-compliance.md), the applicable
  policy UI, and [`../backend/COOKIE_CONSENT_AGENTS.md`](../backend/COOKIE_CONSENT_AGENTS.md).
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
