# Pages (`app/`)

> **Scope:** Next.js routes, layouts, and page-level behavior under
> `frontend/app/`.
>
> **Maintenance:** Update when routes, layouts, public/private access, page
> conventions, or app-level files change.

Inherits repository-wide rules from [`../../AGENTS.md`](../../AGENTS.md) and
frontend rules from [`../AGENTS.md`](../AGENTS.md).

Next.js App Router pages.

## Pages

| Route                   | File                            | Description                |
| ----------------------- | ------------------------------- | -------------------------- |
| `/`                     | `page.tsx`                      | Home landing page          |
| `/my-profile`           | `my-profile/page.tsx`           | Current-player profile dashboard |
| `/playstyle-analysis`   | `playstyle-analysis/page.tsx`   | Current-player playstyle analysis |
| `/matchmaking-analysis` | `matchmaking-analysis/page.tsx` | Match fairness analysis    |
| `/tracked-players`      | `tracked-players/page.tsx`      | Compatibility redirect to current-player profile |
| `/jobs`                 | `jobs/page.tsx`                 | Background jobs monitoring (admin only) |
| `/settings`             | `settings/page.tsx`             | Application + account settings for all users, Riot API config for admins |
| `/sign-in`              | `sign-in/page.tsx`              | Authentication (signed-in users are redirected to `/`) |
| `/join-us`              | `join-us/page.tsx`              | Temporarily hidden route (redirects signed-in users to `/`, signed-out users to `/sign-in`) |
| `/license`              | `license/page.tsx`              | Legal terms page (public; signed-in and signed-out layouts share same URL) |
| `/privacy-policy`       | `privacy-policy/page.tsx`       | Privacy page (public; signed-in and signed-out layouts share same URL) |
| `/cookie-policy`        | `cookie-policy/page.tsx`        | Cookie/storage policy page (public; signed-in and signed-out layouts share same URL) |

## Key Files

| File            | Purpose                           |
| --------------- | --------------------------------- |
| `layout.tsx`    | Root layout with providers        |
| `robots.ts`     | Robots rules (`/robots.txt`) for crawler indexing control |
| `sitemap.ts`    | Sitemap generator (`/sitemap.xml`) for public routes |
| `globals.css`   | Global styles + Tailwind + shadcn |
| `error.tsx`     | Error boundary                    |
| `loading.tsx`   | Root loading state                |
| `not-found.tsx` | 404 page                          |

## Rules

- Add `"use client"` for hooks, browser APIs, event handlers
- Always handle loading/error/success states
- Add new pages to `components/sidebar-nav.tsx`
- Use container pattern: `<div className="container mx-auto py-8">`
- My Profile and Playstyle Analysis consume the shared current-player context;
  they must not restore duplicated large Player Search cards. Preserve
  `?puuid=` for deep links, history, and independent browser tabs.
- Tracked-player management lives in the sidebar dialog. Keep the retired
  `/tracked-players` route as a safe redirect and preserve a supplied PUUID.

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
