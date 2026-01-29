# Features (`features/`)

Domain-specific UI components, hooks, and utilities. Each feature is self-contained.

## Existing Features

- `players/` - Search, cards, stats, tracked list
- `matches/` - Match history, opponent stats
- `playstyle-analysis/` - Analysis results
- `matchmaking/` - Fairness analysis
- `jobs/` - Job management
- `settings/` - Settings UI

## Standard Structure

```
features/<feature-name>/
├── components/          # Feature-specific components
│   ├── player-search.tsx
│   ├── player-card.tsx
│   └── player-stats.tsx
├── hooks/               # Feature-specific hooks (optional)

│   └── use-player-search.ts
├── utils/               # Feature-specific utilities (optional)
│   └── player-formatters.ts
└── index.ts             # Public API exports
```

## File Responsibilities

### `index.ts` - Public API

```typescript
export { PlayerSearch } from "./components/player-search";
export { PlayerCard } from "./components/player-card";
export { usePlayerSearch } from "./hooks/use-player-search";
```

### `components/` - Feature Components

```typescript
"use client";

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/core/api";

interface PlayerSearchProps {
  onPlayerSelect?: (player: Player) => void;
}

export function PlayerSearch({ onPlayerSelect }: PlayerSearchProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Debouncing pattern
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // TanStack Query for data fetching
  const { data, isLoading, error } = useQuery({
    queryKey: ["player-suggestions", debouncedSearch],
    queryFn: () => api.get(`/players/suggestions?q=${debouncedSearch}`),
    enabled: debouncedSearch.length >= 3,
  });

  return (
    <div className="space-y-4">
      <Input
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        placeholder="Search players..."
      />
      {/* Render suggestions */}
    </div>
  );
}
```

**Guidelines**:

- `"use client"` for interactivity
- TypeScript interface for props
- Handle loading/error/success states
- Use shadcn/ui primitives from `@/components/ui/`
- TanStack Query for data fetching
- kebab-case files, PascalCase components

### `hooks/` - Custom Hooks

```typescript
"use client";

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/core/api";

export function usePlayerSearch(initialQuery: string = "") {
  const [searchTerm, setSearchTerm] = useState(initialQuery);
  const [debouncedSearch, setDebouncedSearch] = useState(initialQuery);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const query = useQuery({
    queryKey: ["player-search", debouncedSearch],
    queryFn: () => api.get(`/players/suggestions?q=${debouncedSearch}`),
    enabled: debouncedSearch.length >= 3,
  });

  return {
    searchTerm,
    setSearchTerm,
    suggestions: query.data,
    isLoading: query.isLoading,
    error: query.error,
  };
}
```

### `utils/` - Feature Utilities

```typescript
export function formatRiotId(gameName: string, tagLine: string): string {
  return `${gameName}#${tagLine}`;
}

export function formatRank(tier: string, rank: string, lp: number): string {
  return `${tier} ${rank} (${lp} LP)`;
}
```

## Rules

- Feature components in `features/<feature>/components/`
- Shared layout/infrastructure in `components/`
- shadcn/ui stays in `components/ui/`
- Pages import from features and compose them
- Features expose clean public APIs via `index.ts`

## Create New Feature

1. Create `features/my-feature/`
2. Add subdirectories: `components/`, `hooks/` (optional), `utils/` (optional)
3. Create components in `components/`
4. Create `index.ts` with exports:
   ```typescript
   export { MyComponent } from "./components/my-component";
   export { useMyHook } from "./hooks/use-my-hook";
   ```
5. Import in pages:
   ```typescript
   import { MyComponent } from "@/features/my-feature";
   ```
