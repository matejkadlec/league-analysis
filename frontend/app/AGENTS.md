# Pages (`app/`)

> **Keep this file updated**: When adding pages, update this documentation.

Next.js App Router pages.

## Pages

| Route                   | File                            | Description                |
| ----------------------- | ------------------------------- | -------------------------- |
| `/`                     | `page.tsx`                      | Home landing page          |
| `/playstyle-analysis`   | `playstyle-analysis/page.tsx`   | Player playstyle analysis  |
| `/matchmaking-analysis` | `matchmaking-analysis/page.tsx` | Match fairness analysis    |
| `/tracked-players`      | `tracked-players/page.tsx`      | Tracked list + in-page player profile view |
| `/jobs`                 | `jobs/page.tsx`                 | Background jobs monitoring (admin only) |
| `/settings`             | `settings/page.tsx`             | Application + account settings for all users, Riot API config for admins |
| `/sign-in`              | `sign-in/page.tsx`              | Authentication             |
| `/join-us`              | `join-us/page.tsx`              | Public recruitment + contact form |

## Key Files

| File            | Purpose                           |
| --------------- | --------------------------------- |
| `layout.tsx`    | Root layout with providers        |
| `globals.css`   | Global styles + Tailwind + shadcn |
| `error.tsx`     | Error boundary                    |
| `loading.tsx`   | Root loading state                |
| `not-found.tsx` | 404 page                          |

## Rules

- Add `"use client"` for hooks, browser APIs, event handlers
- Always handle loading/error/success states
- Add new pages to `components/sidebar-nav.tsx`
- Use container pattern: `<div className="container mx-auto py-8">`

## Page Template

```typescript
"use client";

import { useQuery } from "@tanstack/react-query";
import { validatedGet } from "@/lib/core/api";
import { LoadingSkeleton } from "@/components/loading-skeleton";

export default function MyPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["my-data"],
    queryFn: () => validatedGet(Schema, "/endpoint"),
  });

  if (isLoading) return <LoadingSkeleton />;
  if (error) return <div>Error: {error.message}</div>;
  return <div>{/* content */}</div>;
}
```
