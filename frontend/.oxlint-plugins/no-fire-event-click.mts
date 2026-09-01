// `fireEvent.click` dispatches one DOM event at the node; `user.click` performs
// the browser's pointer sequence and checks the element can receive it.

// Flagged: the `fireEvent` members that model a user's own actions. The rest
// model events a user cannot produce directly, which user-event cannot express.

// Callee name only, so an aliased `fireEvent` is invisible -- as is the deeper
// mistake of a test driving a control that production renders `hidden`.

type Node = {
  type: string;
  name?: string;
  callee?: Node;
  object?: Node;
  property?: Node;
};

// Every one of these has a `userEvent` equivalent that models the same user
// action more faithfully.
const USER_ACTIONS = new Set([
  "click",
  "dblClick",
  "hover",
  "unhover",
  "type",
  "keyPress",
  "tripleClick",
]);

export const noFireEventClickRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "A user action is driven through user-event, which checks the element can receive it.",
    },
    schema: [],
    messages: {
      preferUserEvent:
        "`fireEvent.{{name}}` dispatches the event directly at the node, skipping the pointer-events, disabled, visibility and focus checks a browser makes -- so it passes on a control no user can operate. Proven here: a preset button given `pointer-events: none` still passed its fireEvent test and failed the equivalent user-event one. Use `await userEvent.setup().{{name}}(...)`. `fireEvent.change`, `.paste`, `.error`, `.keyDown` and `.blur` are exempt: they model events user-event cannot express.",
    },
  },
  createOnce(context: {
    report: (descriptor: {
      node: Node;
      messageId: string;
      data: Record<string, string>;
    }) => void;
  }) {
    return {
      CallExpression(node: Node) {
        const callee = node.callee;
        if (callee?.type !== "MemberExpression") return;
        if (callee.object?.type !== "Identifier") return;
        if (callee.object.name !== "fireEvent") return;
        if (callee.property?.type !== "Identifier") return;
        const name = callee.property.name ?? "";
        if (!USER_ACTIONS.has(name)) return;
        context.report({ node, messageId: "preferUserEvent", data: { name } });
      },
    };
  },
};
