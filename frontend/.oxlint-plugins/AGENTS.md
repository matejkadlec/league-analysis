# Writing a rule here

House lint rules for oxlint 1.80.0, loaded as one JS plugin named `house`.
Rule IDs are `house/<rule-name>`. A rule's report message is where it states
which invariant it carries and what it cannot see; write that message first.

## Shape

One rule per `<rule-name>.mts`, exporting `<ruleName>Rule`. `index.mts` is the
plugin and the only place a rule is registered; `oxlint.config.mts` is the only
place one is enabled. `.mts` throughout, and **relative imports carry their
extension** — oxlint's Node shim resolves them as ESM, which does not guess.

```ts
export const noExampleRule = {
  meta: { type: "problem", docs: { description: "…" }, schema: [] },
  createOnce(context) {
    return { CallExpression(node) { context.report({ node, message: "…" }); } };
  },
};
```

`createOnce` runs once per process, not once per file: state a rule keeps
across nodes must be reset in `before()`, which also skips the file when it
returns `false`. `context.report` takes a literal `message` or a `messageId`
resolved against `meta.messages`. ESQuery selectors work as visitor keys —
including attribute regexes and `:not()` — which is how `restricted-syntax.mts`
carries a rule oxlint does not implement.

`context.sourceCode` is the full ESLint `SourceCode`: `getAllComments()`,
`lines`, `text`, `getTokenBefore`, and `value`/`loc` on every comment —
`value` is the comment's own text, the only way to read what it says.

## Fixtures are the test

Every rule needs `fixtures/<rule-name>.fixture.ts`. Each shape the rule
must flag gets an `// oxlint-disable-next-line house/<rule-name>` above it;
each shape it must not flag carries no directive. The gate runs the fixtures
with `--report-unused-disable-directives-severity=error`, so a rule that stops
matching turns its directive into an unused one and fails, and a rule that
starts over-matching reports on an accepted case and fails. One file proves
both directions, and it fails on a *regression* rather than on a rewrite.

Prefer an ambient `declare const` over importing app code: fixtures are
excluded from `tsconfig.json` and hold deliberately broken shapes.
