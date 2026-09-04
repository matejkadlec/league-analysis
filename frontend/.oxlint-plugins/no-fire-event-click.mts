// `fireEvent.click` dispatches one DOM event straight at the node. `user.click`
// performs the pointer, focus and keyboard sequence a browser produces, and
// checks on the way that the element can actually receive it.

// Flagged: the `fireEvent` members that model a user's own actions. Accepted:
// the ones that model events a user cannot produce directly, which user-event
// has no equivalent for.

// The boundary: this reads the callee name only, so an aliased `fireEvent` is
// invisible -- as is the deeper version of the mistake, a test driving a
// control production renders `hidden`.

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
