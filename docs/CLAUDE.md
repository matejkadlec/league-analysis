# Docs

`docs/` holds the durable decisions (architecture, workflow, schema,
integrations); `README.md` here is the topic index.

- Update the matching topic document in the same task as a runtime change when
  it alters a durable invariant, a decision's rationale, an externally observed
  fact, or an operational procedure. Mechanical facts (schema columns,
  endpoint lists, module inventories, code-flow narration) live in the code —
  keep them out of docs.
- Schema/model changes always add a reviewed Alembic revision under
  `../backend/alembic/versions/` and apply it via `../backend/scripts/migrate.py`.
- Frozen historical snapshots (dated reviews/audits) are never updated; add a
  supersession note at most.
- Relative links only, every linked target must exist; date externally
  observed facts and cite the source. New topic file => add it to `README.md`
  in the same change.
- Docs-only changes validate with `git diff --check`.
