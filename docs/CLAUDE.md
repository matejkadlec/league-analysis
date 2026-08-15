# Docs

`docs/` holds the durable decisions (architecture, workflow, schema,
integrations); `README.md` here is the topic index.

- Update the matching topic document in the same task as a runtime change when
  it alters a durable invariant, a decision's rationale, an externally observed
  fact, or an operational procedure. Mechanical facts (schema columns,
  endpoint lists, module inventories, code-flow narration) live in the code —
  keep them out of docs.
- Frozen historical snapshots (dated reviews/audits) are never updated; add a
  supersession note at most.
- Date externally observed facts and cite the source.
