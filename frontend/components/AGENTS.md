# Shared Components (`components/`)

> **Scope:** Shared application components and shadcn/ui primitives under
> `frontend/components/`.
>
> **Maintenance:** Update when shared components, primitive policy, naming, or
> component-level conventions change.

Inherits repository-wide rules from [`../../AGENTS.md`](../../AGENTS.md) and
frontend rules from [`../AGENTS.md`](../AGENTS.md).

Shared layout/infrastructure components. Feature-specific components go in `features/`.

## Structure

| File                   | Purpose                                         |
| ---------------------- | ----------------------------------------------- |
| `ui/`                  | shadcn/ui primitives (**DO NOT edit manually**) |
| `sidebar-nav.tsx`      | Navigation sidebar and canonical compact current/recent player switcher surface |
| `section-quick-navigation.tsx` | Hover-expanding in-page section navigation |
| `header-messages.tsx`  | System/admin banners (includes signed-out recruiting notice) |
| `theme-provider.tsx`   | Theme context                                   |
| `theme-toggle.tsx`     | Dark mode toggle                                |
| `providers.tsx`        | TanStack Query, auth, and per-user player-context providers |
| `loading-skeleton.tsx` | Loading states                                  |

## shadcn/ui

**Never edit `ui/` files manually.** Add components via:

```bash
npx shadcn@latest add button card dialog table tabs
```

## Rules

- ✅ Add `"use client"` for hooks/events/browser APIs
- ✅ Use shadcn/ui primitives from `@/components/ui/`
- ✅ Define TypeScript interface for props
- ✅ Use `cn()` utility for conditional classes
- ❌ Don't edit `components/ui/` manually
- ❌ Don't create custom UI primitives (use shadcn)
- ❌ Don't skip TypeScript prop interfaces
- ❌ Don't use direct axios calls (use TanStack Query)
- ❌ Don't forget loading and error states
- `header-messages.tsx` reads the shared backend credential health for every
  authenticated role. Keep polling/focus/event refreshes, use the server health
  revision for dismissible incident IDs, and never infer validity from cached
  or locally completed work.
- ❌ Don't use camelCase for component file names
- Keep the sidebar player selector below the logo and above ordinary
  navigation. Selection persists through the player feature context; it must
  not silently track a player or start Riot synchronization.
- Keep the Manage Tracked Players action at the bottom of the ordinary
  navigation group, immediately above the signed-in user section.
