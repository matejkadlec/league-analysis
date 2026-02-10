# Shared Components (`components/`)

> **Keep this file updated**: When adding shared components, update this documentation.

Shared layout/infrastructure components. Feature-specific components go in `features/`.

## Structure

| File                   | Purpose                                         |
| ---------------------- | ----------------------------------------------- |
| `ui/`                  | shadcn/ui primitives (**DO NOT edit manually**) |
| `sidebar-nav.tsx`      | Navigation sidebar (My Profile currently renders as a regular link; anchor dropdown metadata is preserved for future use) |
| `header-messages.tsx`  | System/admin banners (includes signed-out recruiting notice) |
| `theme-provider.tsx`   | Theme context                                   |
| `theme-toggle.tsx`     | Dark mode toggle                                |
| `providers.tsx`        | TanStack Query provider                         |
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
- ❌ Don't use camelCase for component file names
