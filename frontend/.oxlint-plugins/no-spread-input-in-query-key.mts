// A query key is composed from other query keys, never from a caller's input:
// a spread puts fields into the cache identity that refetch or collide.

// Flagged: a spread of anything but a key in a `queryKey:` array or a
// `*QueryKey` factory's return. Accepted: `...someQueryKey(puuid)`.

// The boundary: a key is recognised by name (`*QueryKey` call, `*_QUERY_KEY`
// constant), not by binding, and only inside `queryKey:` or a key factory.

type Node = {
  type: string;
  name?: string;
  value?: unknown;
  callee?: Node;
  object?: Node;
  property?: Node;
  computed?: boolean;
  key?: Node;
  expression?: Node;
  body?: Node;
  argument?: Node | null;
  elements?: readonly (Node | null)[];
  properties?: readonly Node[];
};

const KEY_CALL = /QueryKey$/;
const KEY_CONSTANT = /(?:^|_)QUERY_KEY$/;

const unwrap = (node: Node | null | undefined): Node | null => {
  if (!node) return null;
  if (
    node.type === "TSAsExpression" ||
    node.type === "TSSatisfiesExpression" ||
    node.type === "TSNonNullExpression"
  )
    return unwrap(node.expression);
  return node;
};

// The callee's own name, through a member chain: `matchmakingStatusQueryKey`
// and `keys.playerQueryKey` both answer with the last segment.
const calleeName = (node: Node | null | undefined): string | null => {
  const value = unwrap(node);
  if (!value) return null;
  if (value.type === "Identifier") return value.name ?? null;
  if (value.type === "MemberExpression" && value.computed === false)
    return calleeName(value.property);
  return null;
};

const isKeyExpression = (node: Node | null | undefined): boolean => {
  const value = unwrap(node);
  if (!value) return false;
  if (value.type === "CallExpression")
    return KEY_CALL.test(calleeName(value.callee) ?? "");
  const name = calleeName(value);
  return name !== null && (KEY_CONSTANT.test(name) || KEY_CALL.test(name));
};

export const noSpreadInputInQueryKeyRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Query keys compose other query keys; a caller's input object never enters one.",
    },
    schema: [],
    messages: {
      spreadInput:
        "Spread a query key here, not this object. Every property the source happens to carry becomes part of the cache identity, so an unrelated field changing refetches the query and a missing one reads a different player's entry. Spread a `*QueryKey()` call or a `*_QUERY_KEY` constant and list the fields the key needs by name.",
    },
  },
  createOnce(context: {
    report: (descriptor: { node: Node; messageId: string }) => void;
  }) {
    // Only the key array's own elements. A spread passed as an *argument* to a
    // factory is that factory's business, and it is not a key element here.
    const check = (node: Node | null | undefined) => {
      const array = unwrap(node);
      if (array?.type !== "ArrayExpression") return;
      for (const element of array.elements ?? []) {
        if (!element) continue;
        if (element.type === "SpreadElement") {
          if (!isKeyExpression(element.argument))
            context.report({ node: element, messageId: "spreadInput" });
          continue;
        }
        const entry = unwrap(element);
        if (entry?.type !== "ObjectExpression") continue;
        for (const property of entry.properties ?? [])
          if (
            property.type === "SpreadElement" &&
            unwrap(property.argument)?.type !== "ObjectExpression"
          )
            context.report({ node: property, messageId: "spreadInput" });
      }
    };

    const checkProperty = (node: Node) =>
      check((node as unknown as { value?: Node }).value);
    const checkReturn = (node: Node) =>
      check((node as unknown as { argument?: Node }).argument);

    return {
      "Property[key.name='queryKey']": checkProperty,
      "Property[key.value='queryKey']": checkProperty,
      // A key that moved into a factory is still a key: reading only the
      // inline form would let the last call site move and take the array with it.
      "FunctionDeclaration[id.name=/QueryKey$/] ReturnStatement": checkReturn,
      "VariableDeclarator[id.name=/QueryKey$/] ReturnStatement": checkReturn,
      "VariableDeclarator[id.name=/QueryKey$/] > ArrowFunctionExpression"(
        node: Node,
      ) {
        check(node.body);
      },
    };
  },
};
