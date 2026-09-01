// `cn` is `twMerge(clsx(...))`: it drops the loser when two Tailwind
// utilities collide, where concatenation leaves stylesheet order to decide.

// Flagged: a `*className` attribute whose top-level value is an interpolated
// template, a ternary, a `&&`/`??`, or a `+`; wrapping it in `cn(...)` passes.

// `cn` is recognised by position, not by import, so a same-named local
// satisfies the rule.

type Node = { type: string; expressions?: readonly unknown[] };

const MESSAGE =
  "Compose this class name with `cn()` from `@/lib/core/utils`. Concatenating instead leaves two conflicting Tailwind utilities both in the string, and the one that wins is decided by stylesheet order rather than by this line -- `cn` runs `twMerge`, which drops the loser.";

const ATTRIBUTE =
  "JSXAttribute[name.name=/^className$|ClassName$/] > JSXExpressionContainer";

export const requireCnForClassnameCompositionRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Class names composed in JSX go through `cn`, so colliding Tailwind utilities resolve.",
    },
    schema: [],
  },
  createOnce(context: { report: (descriptor: unknown) => void }) {
    const report = (node: Node) => {
      context.report({ node, message: MESSAGE });
    };

    return {
      // A template with no `${}` is a plain string written with the wrong
      // quotes, and merges nothing.
      [`${ATTRIBUTE} > TemplateLiteral`](node: Node) {
        if ((node.expressions?.length ?? 0) > 0) report(node);
      },
      [`${ATTRIBUTE} > ConditionalExpression`]: report,
      [`${ATTRIBUTE} > LogicalExpression`]: report,
      [`${ATTRIBUTE} > BinaryExpression[operator='+']`]: report,
    };
  },
};
