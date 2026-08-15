# Shared components (components/)

- Never edit `ui/` files manually — shadcn/ui primitives. Add via
  `npx shadcn@latest add <component>`; no custom UI primitives.
- Feature-specific components go in `features/`, not here. `cn()` for
  conditional classes; TanStack Query, never direct axios; never skip
  loading/error states.
- `header-messages.tsx` polls shared backend credential health — keep the
  polling/focus/event refreshes and the server health revision for
  dismissible incident IDs.
- Sidebar player selector stays below the logo and above ordinary navigation.
  Selection must not silently track a player or start Riot synchronization.
  Player Overview / Match History nav links preserve the current URL's
  explicit `?puuid=` — never rebuild them from only the persisted context.
