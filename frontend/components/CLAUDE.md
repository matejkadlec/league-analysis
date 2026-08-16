# Shared components (components/)

- Never edit `ui/` files manually — they are shadcn/ui primitives. Add one
  with `npx shadcn@latest add <component>`. Left as prose deliberately: a
  hook here would also reject the CLI's own additions.
- One primitive is deliberately patched: `ui/card.tsx` renders `CardTitle` as
  an `h3` rather than the upstream `div`, because card headings carry the
  heading structure of every page. Re-adding `card` from the CLI reverts it;
  `card-title-heading.test.tsx` fails when it does.
