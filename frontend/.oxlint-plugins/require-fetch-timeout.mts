// Every `fetch` carries an abort signal. A backend that accepts the connection
// and then never answers is not hypothetical on a small host, and without a
// deadline the promise never settles.

// Flagged: `fetch(url)` with no init, and an init object literal carrying no
// `signal`. Accepted: any `signal` property, an init spread or an init held in
// a variable, and `new Request(url, { signal })` passed as the input.

// The boundary: this reads the call site only. A `Request` built elsewhere and
// passed by name is treated as a plain input; the axios client in
// `lib/core/http/api.ts` has its own 30s `timeout` and is not visible here.

type Node = {
  type: string;
  name?: string;
  value?: unknown;
  computed?: boolean;
  callee?: Node;
  object?: Node;
  property?: Node;
  key?: Node;
  expression?: Node;
  properties?: readonly Node[];
  arguments?: readonly Node[];
};

// `fetch` reached through a global object is the same call: the edge guard in
// `restricted-syntax.mts` had to learn the member spelling too.
const FETCH_HOSTS = new Set(["global", "globalThis", "self", "window"]);

const isNamed = (node: Node | null | undefined, name: string): boolean =>
  node?.type === "Identifier" && node.name === name;

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

const isFetchCallee = (callee: Node | undefined): boolean => {
  if (isNamed(callee, "fetch")) return true;
  return (
    callee?.type === "MemberExpression" &&
    callee.computed === false &&
    isNamed(callee.property, "fetch") &&
    callee.object?.type === "Identifier" &&
    FETCH_HOSTS.has(callee.object.name ?? "")
  );
};

const staticName = (node: Node | null | undefined): string | null => {
  if (node?.type === "Identifier") return node.name ?? null;
  if (node?.type === "Literal" && typeof node.value === "string")
    return node.value;
  return null;
};

// "opaque" is an init this cannot read -- a variable, or a literal carrying a
// spread. Either may already hold the signal, so neither is reported.
const carriesSignal = (
  init: Node | null | undefined,
): "yes" | "no" | "opaque" => {
  if (!init) return "no";
  const options = unwrap(init);
  if (options?.type !== "ObjectExpression") return "opaque";
  for (const property of options.properties ?? []) {
    if (property.type === "SpreadElement") return "opaque";
    if (property.type === "Property" && staticName(property.key) === "signal")
      return "yes";
  }
  return "no";
};

export const requireFetchTimeoutRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "`fetch` passes an abort signal, so a backend that hangs cannot hang the caller.",
    },
    schema: [],
    messages: {
      missingSignal:
        "Pass a signal here, `{ signal: AbortSignal.timeout(...) }` or a controller's. A backend that accepts the connection and never answers leaves this promise unsettled forever: awaited, the caller stalls with no error to report; fire-and-forget, the connection is held open with nothing left to close it.",
    },
  },
  createOnce(context: {
    report: (descriptor: { node: Node; messageId: string }) => void;
  }) {
    return {
      CallExpression(node: Node) {
        if (!isFetchCallee(node.callee)) return;
        const args = node.arguments ?? [];
        if (carriesSignal(args[1]) !== "no") return;

        // A `Request` assembled right here carries its own signal, and the
        // init above may legitimately be absent because of it.
        const input = unwrap(args[0]);
        if (
          input?.type === "NewExpression" &&
          isNamed(input.callee, "Request") &&
          carriesSignal((input.arguments ?? [])[1]) !== "no"
        )
          return;

        context.report({ node, messageId: "missingSignal" });
      },
    };
  },
};
