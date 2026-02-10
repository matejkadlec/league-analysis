# Features (`features/`)

> **Keep this file updated**: When adding features or components, update this documentation.

Domain-specific UI components. Each feature is self-contained with its own components and exports.

## Features

| Feature               | Description                        |
| --------------------- | ---------------------------------- |
| `auth/`               | Authentication context, rotating refresh tokens, adaptive Turnstile CAPTCHA, public Join Us page/contact form |
| `jobs/`               | Job monitoring components          |
| `matches/`            | Match history display              |
| `matchmaking/`        | Match fairness analysis            |
| `players/`            | Player search, cards, tracking, tracked-list controls |
| `playstyle-analysis/` | Playstyle analysis results         |

## Structure

```
features/<name>/
├── components/           # Feature components
├── index.ts              # Public exports
├── types.ts              # Feature-specific types (optional)
└── utils/                # Feature utilities (optional)
```

## Public API Pattern

```typescript
// features/players/index.ts
export { PlayerSearch } from "./components/player-search";
export { PlayerCard } from "./components/player-card";
```

## Component Pattern

```typescript
"use client";

import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { validatedGet } from "@/lib/core/api";

interface MyComponentProps {
  id: string;
}

export function MyComponent({ id }: MyComponentProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["my-data", id],
    queryFn: () => validatedGet(Schema, `/endpoint/${id}`),
  });

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error</div>;
  return <Card>{data}</Card>;
}
```

## Rules

- `"use client"` for interactivity
- TypeScript interfaces for props
- Handle loading/error/success states
- Use shadcn/ui from `@/components/ui/`
- Export via `index.ts`
- kebab-case files, PascalCase components
