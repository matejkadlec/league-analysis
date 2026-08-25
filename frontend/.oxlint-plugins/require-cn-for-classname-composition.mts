// Composed class names enter through `cn` from `lib/core/utils.ts`. It is
// `twMerge(clsx(...))`, so it drops the loser when two Tailwind utilities
// collide; a template literal concatenates instead, and which of `p-2` and
// `p-4` wins is then whichever the generated stylesheet happens to emit later.

// Flagged: a `className` (or `*ClassName`) attribute whose value is, at the
// top level, an interpolated template, a ternary, a `&&`/`??`, or a `+`.
// Accepted: a plain string, a bare identifier passed through, a template
// with no interpolation, and any of the above once wrapped in `cn(...)`.

// The boundary: only the attribute's own top-level expression is read. A
// composition built in a variable, in a helper, or inside `cn`'s arguments is
// invisible here, and `cn` is recognised by being the call in that position
// rather than by its import, so a same-named local would satisfy the rule.

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
