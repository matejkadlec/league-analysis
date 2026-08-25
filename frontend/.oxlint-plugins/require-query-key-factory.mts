// Every cache-touching call names its key through the factory that owns it.
// `QueryKey` is `unknown[]`, so a hand-typed key compiles forever while the
// factory moves underneath it, and the invalidation then matches nothing.

// Flagged: an array literal as `queryKey:`, as the positional key of
// `setQueryData`/`getQueryData`, or an inline `predicate` key comparison.
// Accepted: `*QueryKey()`, `*_QUERY_KEY`, and a named predicate helper.

// The boundary: the cache is recognised by method name on any receiver, and a
// key hoisted into a local `const` is not resolved. Anything that is not an
// array literal reads as a factory, so `[...key(id), extra]` passes.

type Node = {
  type: string;
  name?: string;
  value?: unknown;
  operator?: string;
  computed?: boolean;
  callee?: Node;
  object?: Node;
  property?: Node;
  key?: Node;
  expression?: Node;
  elements?: readonly (Node | null)[];
  properties?: readonly Node[];
  arguments?: readonly Node[];
  argument?: Node;
  left?: Node;
  right?: Node;
};

// `invalidateQueries` is not the only one that goes stale: this repo also
// refetches by key and reads one back with `getQueryData`, and a drifted key
// there returns `undefined` instead of matching nothing.
const CACHE_METHODS = new Set([
  "cancelQueries",
  "getQueryData",
  "invalidateQueries",
  "refetchQueries",
  "removeQueries",
  "setQueryData",
]);

// These two take the key positionally; the filter-based methods take it as
// `queryKey` inside their options object.
const POSITIONAL_KEY_METHODS = new Set(["getQueryData", "setQueryData"]);

const unwrap = (node: Node | null | undefined): Node | null => {
  if (!node) return null;
  if (
    node.type === "TSAsExpression" ||
    node.type === "TSSatisfiesExpression" ||
    node.type === "TSNonNullExpression" ||
    node.type === "ChainExpression"
  )
    return unwrap(node.expression);
  return node;
};

const staticName = (node: Node | null | undefined): string | null => {
  if (!node) return null;
  if (node.type === "Identifier") return node.name ?? null;
  if (node.type === "Literal" && typeof node.value === "string")
    return node.value;
  return null;
};

const methodName = (callee: Node | undefined): string | null => {
  if (callee?.type !== "MemberExpression" || callee.computed !== false)
    return null;
  return staticName(callee.property);
};

const arrayLiteral = (node: Node | null | undefined): Node | null => {
  const value = unwrap(node);
  return value?.type === "ArrayExpression" ? value : null;
};

// `queryKey`, `query.queryKey`, `q.queryKey` -- the value a predicate walks.
const isQueryKeyReference = (node: Node | null | undefined): boolean => {
  const value = unwrap(node);
  if (!value) return false;
  if (value.type === "Identifier") return value.name === "queryKey";
  return (
    value.type === "MemberExpression" &&
    value.computed === false &&
    staticName(value.property) === "queryKey"
  );
};

// `.at(-1)` parses as a unary minus wrapped around the literal.
const isNumericLiteral = (node: Node | null | undefined): boolean => {
  const value = unwrap(node);
  if (!value) return false;
  if (value.type === "Literal") return typeof value.value === "number";
  return (
    value.type === "UnaryExpression" &&
    value.operator === "-" &&
    isNumericLiteral(value.argument)
  );
};

// `queryKey.at(3)` or `queryKey[3]`: a position read off a key.
const isKeyPositionRead = (node: Node | null | undefined): boolean => {
  const value = unwrap(node);
  if (!value) return false;
  if (value.type === "CallExpression") {
    const callee = unwrap(value.callee);
    if (
      callee?.type !== "MemberExpression" ||
      callee.computed !== false ||
      staticName(callee.property) !== "at"
    )
      return false;
    const args = value.arguments ?? [];
    return (
      args.length === 1 &&
      isNumericLiteral(args[0]) &&
      isQueryKeyReference(callee.object)
    );
  }
  return (
    value.type === "MemberExpression" &&
    value.computed === true &&
    isNumericLiteral(value.property) &&
    isQueryKeyReference(value.object)
  );
};

export const requireQueryKeyFactoryRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Cache reads and invalidations name their key through the factory that defines it.",
    },
    schema: [],
    messages: {
      inlineQueryKey:
        "Call the key factory here instead of typing the array out. `QueryKey` is `unknown[]`, so this copy keeps compiling after the factory's shape changes and quietly stops matching the entry it was meant to reach -- the cache then serves stale data for its whole stale window with nothing failing.",
      inlinePredicate:
        "Match the key with a named helper exported beside the factory, the way `isMatchHistoryQuery` does, not with an inline position comparison. A positional walk written here restates the factory's layout in a second place that nothing checks.",
    },
  },
  createOnce(context: {
    report: (descriptor: { node: Node; messageId: string }) => void;
  }) {
    const reportPredicate = (node: Node) => {
      if (node.operator !== "===" && node.operator !== "!==") return;
      if (!isKeyPositionRead(node.left) && !isKeyPositionRead(node.right))
        return;
      context.report({ node, messageId: "inlinePredicate" });
    };

    return {
      CallExpression(node: Node) {
        const method = methodName(node.callee);
        if (method === null || !CACHE_METHODS.has(method)) return;
        const args = node.arguments ?? [];

        if (POSITIONAL_KEY_METHODS.has(method)) {
          const positional = arrayLiteral(args[0]);
          if (positional)
            context.report({ node: positional, messageId: "inlineQueryKey" });
        }

        for (const argument of args) {
          const options = unwrap(argument);
          if (options?.type !== "ObjectExpression") continue;
          for (const property of options.properties ?? []) {
            if (
              property.type !== "Property" ||
              staticName(property.key) !== "queryKey"
            )
              continue;
            const key = arrayLiteral(property.value as Node | undefined);
            if (key) context.report({ node: key, messageId: "inlineQueryKey" });
          }
        }
      },

      // The enclosing filters object is often hoisted into a local, so the
      // call site is not a reliable anchor: the `predicate` property is.
      "Property[key.name='predicate'] BinaryExpression": reportPredicate,
      "Property[key.value='predicate'] BinaryExpression": reportPredicate,
    };
  },
};
