// JSON text reaching this app came from somewhere it does not control -- a
// viewer's storage, a beacon body -- and `JSON.parse` answers `any`. Every
// other foreign payload here crosses through a zod schema; these do too.

// Flagged: any `JSON.parse` call in application code. `lib/core/untrusted-json.ts`
// owns the one call, and `oxlint.config.mts` exempts it and the test tree.

type Node = {
  type: string;
  name?: string;
  callee?: Node;
  object?: Node;
  property?: Node;
  computed?: boolean;
};

const isNamed = (node: Node | null | undefined, name: string): boolean =>
  node?.type === "Identifier" && node.name === name;

export const noRawJsonParseRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "JSON from outside this app is parsed through a schema, not by hand.",
    },
    schema: [],
    messages: {
      rawParse:
        "Use `parseUntrustedJson(schema, raw)` from `lib/core/untrusted-json.ts`. `JSON.parse` hands back `any` and throws on malformed text, so each reader grows its own try/catch and its own shape check -- and a hand-rolled check drifts from the type it is standing in for without the compiler noticing.",
    },
  },
  createOnce(context: {
    report: (descriptor: { node: Node; messageId: string }) => void;
  }) {
    return {
      CallExpression(node: Node) {
        const callee = node.callee;
        if (
          callee?.type !== "MemberExpression" ||
          callee.computed === true ||
          !isNamed(callee.object, "JSON") ||
          !isNamed(callee.property, "parse")
        )
          return;
        context.report({ node, messageId: "rawParse" });
      },
    };
  },
};
