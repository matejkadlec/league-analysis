# Tech Stack

Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, shadcn/ui (New York), TanStack Query v5, Zod v4, react-hook-form, Axios, next-themes, sonner, lucide-react

# Structure

**Feature-based**: Related UI grouped by domain

## Pages (`app/`)

Next.js App Router pages:

- `page.tsx` - Home/dashboard
- `player-analysis/page.tsx` - Player analysis
- `matchmaking-analysis/page.tsx` - Matchmaking fairness
- `tracked-players/page.tsx` - Tracked players management
- `jobs/page.tsx` - Background jobs control
- `settings/page.tsx` - System settings

## Features (`features/`)

Domain-specific components, hooks, utilities:

- `players/` - Search, cards, stats, tracked list
- `matches/` - Match history, opponent stats
- `player-analysis/` - Analysis results
- `matchmaking/` - Fairness analysis
- `jobs/` - Job management
- `settings/` - Settings UI

Each feature: `components/`, `hooks/` (optional), `utils/` (optional), `index.ts`

## Shared (`components/`)

Layout/infrastructure only (NOT feature-specific):

- `sidebar-nav.tsx` - Navigation
- `theme-provider.tsx`, `theme-toggle.tsx` - Dark mode
- `providers.tsx` - TanStack Query provider
- `loading-skeleton.tsx` - Generic loading states
- `ui/` - **shadcn/ui primitives (DO NOT MOVE)**

## Core (`lib/core/`)

- `api.ts` - Axios client config
- `schemas.ts` - Shared Zod schemas
- `validations.ts` - Validation utilities
- `utils.ts` - Generic utilities (cn(), formatters)
- `hooks.ts` - Toast notifications

# Rules

**Component placement**:

- Used by ONE feature → `features/<feature>/components/`
- Shared layout/infrastructure → `components/`
- shadcn/ui → `components/ui/` (never move)

**Public exports**:

```typescript
// features/players/index.ts
export { PlayerSearch } from "./components/player-search";
export { PlayerCard } from "./components/player-card";
```

**Imports**:

```typescript
// Features (public API)
import { PlayerSearch, PlayerCard } from "@/features/players";
import { MatchHistory } from "@/features/matches";

// Features (direct)
import { PlayerSearch } from "@/features/players/components/player-search";

// Core
import { api } from "@/lib/core/api";
import { playerSchema } from "@/lib/core/schemas";
import { cn } from "@/lib/core/utils";
import { useToast } from "@/lib/core/hooks";

// Shared
import { Button } from "@/components/ui/button";
import { SidebarNav } from "@/components/sidebar-nav";
```

**Code style**:

- TypeScript strict mode (no `any`)
- kebab-case for files, PascalCase for components
- `"use client"` for hooks/events/browser APIs
- Follow shadcn/ui patterns
- TanStack Query for all data fetching
- Handle loading/error/success states
- Debouncing for search (useEffect + setTimeout)
- Keyboard nav for autocomplete (ArrowUp/Down, Enter, Escape)

# Commands

```bash
npm run dev      # Start dev server (hot reload)
npm run build    # Build for production
rm -rf .next     # Clear build cache
```

# Add New Feature

1. Create `features/my-feature/`
2. Add subdirectories: `components/`, `hooks/` (optional), `utils/` (optional)
3. Create `index.ts`:
   ```typescript
   export { MyComponent } from "./components/my-component";
   export { useMyHook } from "./hooks/use-my-hook";
   ```
4. Import in pages:
   ```typescript
   import { MyComponent } from "@/features/my-feature";
   ```
