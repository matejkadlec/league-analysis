# Shared Components (`components/`)

> **Scope:** Shared component rules and shadcn/ui policy under
> `frontend/components/`.
>
> **Maintenance:** Update when the primitive policy or a shared-component
> invariant changes. The component inventory lives in the code.

Inherits repository-wide rules from [`../../AGENTS.md`](../../AGENTS.md) and
frontend rules from [`../AGENTS.md`](../AGENTS.md).

Shared layout/infrastructure components live here; feature-specific components
go in `features/`.

## Rules

- **Never edit `ui/` files manually** — they are shadcn/ui primitives. Add
  components via `npx shadcn@latest add <component>`; do not create custom UI
  primitives.
- Use `cn()` for conditional classes; no direct axios calls (use TanStack
  Query); never skip loading/error states or TypeScript prop interfaces; no
  camelCase component file names.
- `header-messages.tsx` reads the shared backend credential health for every
  authenticated role. Keep polling/focus/event refreshes, use the server health
  revision for dismissible incident IDs, and never infer validity from cached
  or locally completed work.
- Keep the sidebar player selector below the logo and above ordinary
  navigation. Selection persists through the player feature context; it must
  not silently track a player or start Riot synchronization.
- Keep the Manage Tracked Players action at the bottom of the ordinary
  navigation group, immediately above the signed-in user section.
