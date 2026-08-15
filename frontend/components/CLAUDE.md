# Shared components (components/)

- Never edit `ui/` files manually — they are shadcn/ui primitives. Add one
  with `npx shadcn@latest add <component>`.
- `header-messages.tsx` polls shared backend credential health — keep the
  polling/focus/event refreshes and the server health revision that makes
  incident IDs dismissible.
- Player Overview / Match History nav links preserve the current URL's
  explicit `?puuid=` — never rebuild them from only the persisted context.
  Selecting a player in the sidebar must not silently track that player or
  start Riot synchronization.
