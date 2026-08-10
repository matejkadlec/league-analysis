# Frontend (`frontend/`)

> **Scope:** Frontend-wide architecture and conventions under `frontend/`.
>
> **Maintenance:** Update when the frontend stack, shared patterns, feature
> layout, global styling system, or frontend commands change.

Repository identity, delivery workflow, and safety rules are inherited from
[`../AGENTS.md`](../AGENTS.md). This guide may add frontend constraints but may
not weaken repository-wide rules.

## Tech Stack

Node 26.5.1, npm 12.0.2, Next.js 16.3 (App Router), React 19, TypeScript 7
native compiler with a TypeScript 6 API compatibility alias for ESLint,
Tailwind CSS 4, shadcn/ui (New York), TanStack Query v5, Zod v4, Axios, sonner,
lucide-react, Vitest 4 with Testing Library (React and user-event) and jsdom
for DOM component tests

Next's TypeScript API mode remains explicitly enabled because the compatibility
alias exposes the TypeScript 6 compiler API but not Next 16.3's expected
`typescript/bin/tsc` CLI path.

## Structure

```
frontend/
├── app/                 # Next.js pages (see app/AGENTS.md)
├── components/          # Shared components (see components/AGENTS.md)
│   └── ui/              # shadcn/ui primitives (DO NOT EDIT)
├── features/            # Domain UI (see features/AGENTS.md)
│   ├── auth/
│   ├── cookie-consent/
│   ├── jobs/
│   ├── matches/
│   ├── matchmaking/
│   ├── players/
│   ├── playstyle-analysis/
│   └── profile/
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

### Dialog Template Pattern

Use this shared structure for user-action dialogs across frontend features.

- Overlay and behavior:
  - Use shadcn `Dialog` + `DialogContent` (darkened background handled by overlay)
  - Always add `dialog-white-border` class to `DialogContent` for visibility
  - Keep default close interactions enabled: top-right `X`, outside click, and explicit cancel button
  - Keep the global vertical position from `globals.css`: remaining viewport
    space must use a 1:2 top-to-bottom ratio (`X` above, `2X` below). Do not
    center or override an individual dialog's `top`/vertical translation.
- Layout:
  - Header with **gold icon** + title — every dialog title must include a relevant lucide icon with classes `h-5 w-5 text-[#cfa93a]`
  - Optional short description via `DialogDescription`
  - Body contains feature-specific fields and inline validation messages
  - Footer uses `flex items-center justify-between gap-2` layout (cancel left, actions right)
- Actions:
  - **All dialog buttons** must use `py-2 px-4` for consistent sizing
  - Left action = `Cancel` with `className="red-gradient"` and `<StopCircle className="h-4 w-4" />` icon — this is mandatory for all cancel buttons across the app
  - Right action = submit CTA with `className="button-medium no-rotation"` or `className="gold-gradient"` and a relevant icon
  - Card-level action buttons outside dialogs should use `className="button-full"` and icon
- Validation UX:
  - Show errors directly under the related field
  - Keep field-specific messages concise and deterministic

## Rules

- TypeScript strict mode (no `any`)
- `"use client"` for hooks/events/browser APIs
- TanStack Query for all data fetching
- Handle loading/error/success states
- Resolve the current Data Dragon version server-side through the cached
  manifest helper and consume it through `useDDragonVersion()` for versioned
  assets. Keep the reviewed fallback and null behavior for unknown IDs.
- Features expose public APIs via `index.ts`
- Use Next.js `proxy.ts` file convention (not `middleware.ts`)
- **Every interactive element** (`button`, `a`, `[role="button"]`, etc.) must have `cursor: pointer` — enforced globally via `globals.css`, no per-element override needed
- **Use custom CSS classes from `globals.css`** — the app defines reusable gradient and utility classes:
  - `.gold-gradient` — primary CTA (confirm, start, submit) — gold gradient
  - `.red-gradient` — destructive actions (cancel, delete, stop) — red gradient
  - `.blue-gradient` — neutral/secondary actions (decline, dismiss) — blue gradient
  - `.button-small` / `.button-medium` / `.button-full` — gold button size variants with hover effects
  - `.icon-circle` — 24×24px gold circle icon button (card headers)
  - `.dialog-white-border` — white border for dialog visibility against dark backgrounds
  - `.vertical-gradient` — vertical gold gradient background
  - Always prefer these over inline Tailwind for branded styling
- **Toast notifications** — use sonner with `richColors` (configured in `layout.tsx`). Use the correct variant for every toast:
  - `variant: "success"` (green) — confirmed actions: saved, updated, deleted, connected
  - `variant: "error"` (red) — failures, validation errors, rate limits
  - `variant: "info"` (blue) — informational: triggered, started, stopped, paused, resumed
  - `variant: "warning"` (amber) — warnings, cancellations
  - **Never** use the default variant (white/unstyled) — always pick one of the above
  - Use `useToast()` hook from `@/lib/core/hooks` (wraps sonner with `{ title, description, variant, duration }`)
  - Default duration is 4000ms; use `duration: 1000` only for quick inline confirmations (e.g. "Settings saved")

## Commands

```bash
../test.sh -f    # Repository tooling plus the complete frontend gate
npm run dev      # Start dev server
npm run lint     # ESLint
npm run typecheck
npm test         # Deterministic Vitest regressions
npm run test:e2e # Playwright pagination/browser regressions (after installing Chromium)
npm run build    # Production build
rm -rf .next     # Clear cache
```

The authoritative gate selects the Node version from `../.nvmrc`, installs with
`npm ci`, rejects ESLint warnings, and preserves tracked `next-env.d.ts` content
across the production build.

Install the matching browser before running the separate Playwright suite:

```bash
npx playwright install chromium
```

The production image is defined by `Dockerfile`, installs with `npm ci`, builds
the Next standalone output, and runs `server.js` as non-root UID/GID 10001.
`NEXT_PUBLIC_API_URL` is the browser-visible backend origin baked at build
time; `API_INTERNAL_URL` is the server-side rewrite destination and points to
the private Compose backend service. Normal `npm run dev` and repository
`./run.sh` keep their localhost defaults and never require Docker.

## Related Docs

- [app/AGENTS.md](app/AGENTS.md) - Page patterns
- [components/AGENTS.md](components/AGENTS.md) - Shared components
- [features/AGENTS.md](features/AGENTS.md) - Feature components
