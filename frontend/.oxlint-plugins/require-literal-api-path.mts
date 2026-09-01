// Two scanners find this app's requests by regex-matching the URL argument at
// the call site, so a path they cannot read is a path nothing checks.

type Node = {
  type: string;
  name?: string;
  value?: unknown;
  computed?: boolean;
  optional?: boolean;
  callee?: Node;
  object?: Node;
  property?: Node;
  arguments?: readonly Node[];
};

const HELPERS = new Set([
  "validatedGet",
  "validatedPost",
  "validatedPut",
  "validatedPatch",
  "validatedDelete",
]);

// `client.validatedGet(...)` too: both scanners match the helper name wherever
// it appears, so a member spelling is scanned and must obey the same rule.
const helperName = (callee: Node | undefined): string | null => {
  if (callee?.type === "Identifier" && HELPERS.has(callee.name ?? ""))
    return callee.name ?? null;
  if (
    callee?.type === "MemberExpression" &&
    callee.computed === false &&
    callee.property?.type === "Identifier" &&
    HELPERS.has(callee.property.name ?? "")
  )
    return callee.property.name ?? null;
  return null;
};

const isReadablePath = (node: Node | undefined): boolean =>
  node?.type === "TemplateLiteral" ||
  (node?.type === "Literal" && typeof node.value === "string");

export const requireLiteralApiPathRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Every `validated*` request spells its URL inline, so the path scanners can read it.",
    },
    schema: [],
    messages: {
      hoistedPath:
        "Spell this URL inline as a string or template literal. `backend/tests/test_frontend_api_paths.py` and `calledApiPaths()` in `tests/api-contract-alignment.test.ts` both find requests by regex-matching the literal in the second argument, and both skip a call whose path they cannot read: behind a constant, a helper, or a concatenation, this request stops being checked against the routes the API serves and nothing reports it. Move the whole call rather than the path.",
    },
  },
  createOnce(context: {
    report: (descriptor: { node: Node; messageId: string }) => void;
  }) {
    return {
      CallExpression(node: Node) {
        if (helperName(node.callee) === null) return;
        const path = (node.arguments ?? [])[1];
        if (isReadablePath(path)) return;
        context.report({ node: path ?? node, messageId: "hoistedPath" });
      },
    };
  },
};
