# Frontend (`frontend/`)

> **Keep this file updated** when making frontend changes.

## Tech Stack

Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, shadcn/ui (New York), TanStack Query v5, Zod v4, Axios, sonner, lucide-react

## Structure

```
frontend/
├── app/                 # Next.js pages (see app/AGENTS.md)
├── components/          # Shared components (see components/AGENTS.md)
│   └── ui/              # shadcn/ui primitives (DO NOT EDIT)
├── features/            # Domain UI (see features/AGENTS.md)
│   ├── auth/
│   ├── jobs/
│   ├── matches/
│   ├── matchmaking/
│   ├── players/
│   └── playstyle-analysis/
└── lib/core/            # Utilities (api, schemas, utils)
```

## Code Patterns

### Imports

```typescript
// Features (public API)
import { PlayerSearch, PlayerCard } from "@/features/players";
import { MatchHistory } from "@/features/matches";

// Core utilities
import { api, validatedGet } from "@/lib/core/api";
import { PlayerSchema } from "@/lib/core/schemas";
import { cn } from "@/lib/core/utils";

// Shared components
import { Button } from "@/components/ui/button";
```

### Data Fetching

```typescript
const { data, isLoading, error } = useQuery({
  queryKey: ["player", puuid],
  queryFn: () => validatedGet(PlayerSchema, `/players/${puuid}`),
});
```

### Component Pattern

```typescript
"use client";

interface MyComponentProps {
  puuid: string;
}

export function MyComponent({ puuid }: MyComponentProps) {
  // Loading state
  if (isLoading) return <Skeleton />;

  // Error state
  if (error) return <Alert variant="destructive">...</Alert>;

  // Success state
  return <div>...</div>;
}
```

## Rules

- TypeScript strict mode (no `any`)
- `"use client"` for hooks/events/browser APIs
- TanStack Query for all data fetching
- Handle loading/error/success states
- Features expose public APIs via `index.ts`

## Commands

```bash
npm run dev      # Start dev server
npm run build    # Production build
rm -rf .next     # Clear cache
```

## Related Docs

- [app/AGENTS.md](app/AGENTS.md) - Page patterns
- [components/AGENTS.md](components/AGENTS.md) - Shared components
- [features/AGENTS.md](features/AGENTS.md) - Feature components
