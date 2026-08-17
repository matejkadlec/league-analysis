# Shared components (components/)

- Never edit `ui/` files manually — they are shadcn/ui primitives. Add one
  with `npx shadcn@latest add <component>`. Left as prose deliberately: a
  hook here would also reject the CLI's own additions.
- Two primitives are deliberately patched, each guarded by a render test that
  fails if the CLI re-adds the component and reverts the patch:
  - `ui/card.tsx` renders `CardTitle` as an `h3` rather than the upstream
    `div`, because card headings carry the heading structure of every page
    (`card-title-heading.test.tsx`). `CardTitle` is a heading element, so put
    only its text inside it — badges and controls belong beside it in
    `CardHeader`, not within the heading.
  - `ui/dialog.tsx` bakes `dialog-white-border` into `DialogContent`, so no
    call site can forget the edge that keeps a dialog visible against the dark
    background (`dialog-white-border.test.tsx`).
