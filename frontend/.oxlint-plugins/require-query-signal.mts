// Reading `signal` off the context sets `abortSignalConsumed`, the only thing
// that makes the client abort once the last observer unmounts.

// Function literals only, both branches of a `skipToken` conditional included; a
// `queryFn` passed by name cannot be read here.

type Node = {
  type: string;
  name?: string;
  key?: Node;
  value?: Node;
  computed?: boolean;
  shorthand?: boolean;
  params?: readonly Node[];
  properties?: readonly Node[];
  argument?: Node;
  consequent?: Node;
  alternate?: Node;
  expression?: Node;
};

const staticName = (node: Node | null | undefined): string | null =>
  node?.type === "Identifier" ? (node.name ?? null) : null;

const isFunction = (node: Node | null | undefined): boolean =>
  node?.type === "ArrowFunctionExpression" ||
  node?.type === "FunctionExpression";

const destructuresSignal = (parameter: Node | null | undefined): boolean => {
  if (parameter?.type !== "ObjectPattern") return false;
  return (parameter.properties ?? []).some(
    (property) =>
      property.type === "RestElement" ||
      (property.type === "Property" && staticName(property.key) === "signal"),
  );
};

// A conditional is the `skipToken` shape: one branch is the function, the
// other the token. Both branches are walked, so neither can be the gap.
const functionsIn = (node: Node | null | undefined): Node[] => {
  if (!node) return [];
  if (isFunction(node)) return [node];
  if (node.type === "ConditionalExpression")
    return [...functionsIn(node.consequent), ...functionsIn(node.alternate)];
  return [];
};

export const requireQuerySignalRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "A `queryFn` takes React Query's `signal`, so an abandoned query stops holding its request open.",
    },
    schema: [],
    messages: {
      missingSignal:
        "Take `{ signal }` here and pass it to the request. React Query aborts a fetch when its last observer unmounts only if the `queryFn` read `signal` off the context, so without it a page navigated away from mid-fetch keeps its connection to completion.",
    },
  },
  createOnce(context: {
    report: (descriptor: { node: Node; messageId: string }) => void;
  }) {
    return {
      Property(node: Node) {
        if (node.computed === true || node.shorthand === true) return;
        if (staticName(node.key) !== "queryFn") return;
        for (const fn of functionsIn(node.value)) {
          if (!destructuresSignal((fn.params ?? [])[0])) {
            context.report({ node: fn, messageId: "missingSignal" });
          }
        }
      },
    };
  },
};
