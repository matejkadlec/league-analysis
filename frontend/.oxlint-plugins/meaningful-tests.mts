// Two test shapes that stay green while the behaviour they name is broken: a
// test whose every assertion is a mock-call check, and `toThrow()` with no
// argument, which any TypeError satisfies as well as the error it claims to pin.

// Flagged: an `it`/`test` body whose every `expect` matcher is a call matcher;
// a bare `toThrow()` / `toThrowError()`. Accepted: call assertions next to an
// outcome assertion; `not.toThrow()`, which has nothing to name; hooks.

// The boundary: syntax cannot tell an assertion from a tautology. A test
// asserting a mocked return value reads as fine here, and one with no
// assertions at all is left to the suite's own "0 assertions" report.

type Node = {
  type: string;
  name?: string;
  callee?: Node;
  object?: Node;
  property?: Node;
  tag?: Node;
  arguments?: readonly Node[];
};

type Frame = { node: Node; expects: number; outcomeExpects: number };

const CALL_MATCHERS = new Set([
  "toHaveBeenCalled",
  "toHaveBeenCalledWith",
  "toHaveBeenCalledTimes",
  "toHaveBeenCalledOnce",
  "toHaveBeenCalledExactlyOnceWith",
  "toHaveBeenLastCalledWith",
  "toHaveBeenNthCalledWith",
  "toBeCalled",
  "toBeCalledWith",
  "toBeCalledTimes",
]);

const THROW_MATCHERS = new Set(["toThrow", "toThrowError"]);
const TEST_FNS = new Set(["it", "test"]);

// `test.beforeEach`, `test.describe` and `test.setTimeout` are calls on the
// same object in the Playwright specs, and assert nothing themselves. Only the
// members that still produce a test count.
const TEST_MODIFIERS = new Set([
  "each",
  "for",
  "only",
  "skip",
  "todo",
  "fails",
  "concurrent",
  "sequential",
  "runIf",
  "skipIf",
]);

// `it.each(table)(name, fn)` and ``it.each`…`(name, fn)`` call the result of a
// call, so the callee is walked rather than matched.
const isTestCallee = (callee: Node | undefined): boolean => {
  if (!callee) return false;
  if (callee.type === "Identifier") return TEST_FNS.has(callee.name ?? "");
  if (callee.type === "MemberExpression")
    return (
      callee.property?.type === "Identifier" &&
      TEST_MODIFIERS.has(callee.property.name ?? "") &&
      isTestCallee(callee.object)
    );
  if (callee.type === "CallExpression") return isTestCallee(callee.callee);
  if (callee.type === "TaggedTemplateExpression") return isTestCallee(callee.tag);
  return false;
};

// Walks `expect(x).resolves.not.toThrow()` back to the `expect` call, so the
// matcher is read through however many `.rejects` / `.not` sit in between.
const expectChain = (
  node: Node,
): { matcher: string; negated: boolean } | null => {
  const callee = node.callee;
  if (callee?.type !== "MemberExpression") return null;
  if (callee.property?.type !== "Identifier") return null;
  let negated = false;
  let target = callee.object;
  while (target?.type === "MemberExpression") {
    if (target.property?.type === "Identifier" && target.property.name === "not")
      negated = true;
    target = target.object;
  }
  const isExpect =
    target?.type === "CallExpression" &&
    target.callee?.type === "Identifier" &&
    target.callee.name === "expect";
  return isExpect ? { matcher: callee.property.name ?? "", negated } : null;
};

export const meaningfulTestsRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "A test asserts an observable outcome, and an expected throw names the error it expects.",
    },
    schema: [],
    messages: {
      callAssertionsOnly:
        "Every assertion here is a mock-call check: it pins the wiring, and passes while the value returned, the element rendered or the toast raised is wrong. Assert the observable outcome as well - call assertions corroborate one, they cannot stand in for it.",
      unspecifiedThrow:
        "toThrow() with no argument is satisfied by every error, the TypeError from the bug included, so it cannot tell the failure it names from a broken call. Name the message or the error class. `not.toThrow()` is exempt: there is nothing to name.",
    },
  },
  createOnce(context: {
    report: (descriptor: { node: Node; messageId: string }) => void;
  }) {
    let stack: Frame[] = [];
    return {
      before() {
        stack = [];
      },
      CallExpression(node: Node) {
        if (isTestCallee(node.callee)) {
          stack.push({ node, expects: 0, outcomeExpects: 0 });
          return;
        }
        const chain = expectChain(node);
        if (!chain) return;
        const frame = stack[stack.length - 1];
        if (frame) {
          frame.expects += 1;
          if (!CALL_MATCHERS.has(chain.matcher)) frame.outcomeExpects += 1;
        }
        if (
          THROW_MATCHERS.has(chain.matcher) &&
          !chain.negated &&
          (node.arguments?.length ?? 0) === 0
        )
          context.report({ node, messageId: "unspecifiedThrow" });
      },
      "CallExpression:exit"(node: Node) {
        const frame = stack[stack.length - 1];
        if (!frame || frame.node !== node) return;
        stack.pop();
        if (frame.expects > 0 && frame.outcomeExpects === 0)
          context.report({ node, messageId: "callAssertionsOnly" });
      },
    };
  },
};
