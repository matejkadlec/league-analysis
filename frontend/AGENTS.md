# Frontend (`frontend/`)

> **Scope:** Frontend-wide constraints, design-system contract, and commands
> under `frontend/`.
>
> **Maintenance:** Update when a frontend-wide rule, the design-system
> contract, or a command boundary changes. Directory structure and code
> patterns live in the code; do not mirror them here.

Repository identity, delivery workflow, and safety rules are inherited from
[`../AGENTS.md`](../AGENTS.md). This guide may add frontend constraints but may
not weaken repository-wide rules.

Stack: Node (pinned by `.nvmrc`) with npm (pinned by `packageManager`),
Next.js App Router, React 19, TypeScript strict, Tailwind CSS 4, shadcn/ui
(New York), TanStack Query v5, Zod v4, Axios, sonner, lucide-react, Vitest
with Testing Library and jsdom. Domain UI lives under `features/<name>/`,
shared components under `components/`, utilities under `lib/core/`.

The `typescript` package is an npm alias to the TypeScript 6 compatibility
API while the native TypeScript 7 compiler supplies `tsc`; Next's TypeScript
API mode remains explicitly enabled because the alias exposes the compiler API
but not the `typescript/bin/tsc` CLI path ESLint tooling expects.

## Rules

- TypeScript strict mode (no `any`); TypeScript interfaces for props;
  kebab-case files, PascalCase components.
- `"use client"` for hooks/events/browser APIs.
- TanStack Query for all data fetching (`validatedGet` + Zod schemas from
  `lib/core`); always handle loading/error/success states.
- Resolve the current Data Dragon version server-side through the cached
  manifest helper and consume it through `useDDragonVersion()` for versioned
  assets. Keep the reviewed fallback and null behavior for unknown IDs.
- Features expose public APIs via `index.ts`.
- Use Next.js `proxy.ts` file convention (not `middleware.ts`).

## Design-System Contract

These are product design decisions, not suggestions:

- **Every interactive element** (`button`, `a`, `[role="button"]`, etc.) has
  `cursor: pointer` — enforced globally via `globals.css`, no per-element
  override needed.
- **Use the custom classes from `globals.css`** for branded styling instead of
  inline Tailwind: `.gold-gradient` (primary CTA), `.red-gradient`
  (destructive/cancel), `.blue-gradient` (neutral/secondary),
  `.button-small`/`.button-medium`/`.button-full` (gold button sizes),
  `.icon-circle` (24×24px gold circle icon button), `.dialog-white-border`
  (dialog visibility), `.vertical-gradient`.
- **Dialogs** use shadcn `Dialog` + `DialogContent` with
  `dialog-white-border`, keep default close interactions (top-right `X`,
  outside click, explicit cancel), and keep the global vertical position from
  `globals.css` (remaining viewport space in a 1:2 top-to-bottom ratio — do
  not center or override an individual dialog's `top`/translation). Every
  dialog title includes a relevant lucide icon with `h-5 w-5 text-[#cfa93a]`.
  All dialog buttons use `py-2 px-4`; the footer is
  `flex items-center justify-between gap-2` with Cancel on the left
  (`red-gradient` + `StopCircle` icon — mandatory for all cancel buttons
  across the app) and the submit CTA on the right (`button-medium
  no-rotation` or `gold-gradient` plus a relevant icon). Card-level action
  buttons outside dialogs use `button-full` and an icon. Show validation
  errors directly under the related field.
- **Toasts** use sonner with `richColors` through the `useToast()` hook from
  `@/lib/core/hooks`; only that adapter and the shared `ToastHost` may import
  sonner directly. Always pick an explicit variant — `success` (dark green,
  completed actions), `error` (dark red, failures), `info` (dark blue,
  informational, queued, started, or running states), `warning` (dark amber)
  — never the default unstyled variant. The shared host supplies
  `CircleCheckBig`, `CircleX`, `Info`, and `TriangleAlert` before the toast
  title. Default duration is 4000ms; use `duration: 1000` only for quick inline
  confirmations.
- Normalize API failures through `lib/core/api-error.ts`. UI may present safe
  typed validation and business messages, but must replace unexpected,
  provider, transport, and infrastructure details with a contextual product
  message. Never render raw response bodies or unclassified exception text.

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
across the production build. Install the matching browser once before the
separate Playwright suite: `npx playwright install chromium`.

The production image is defined by `Dockerfile`, installs with `npm ci`, builds
the Next standalone output, and runs `server.js` as non-root UID/GID 10001.
`NEXT_PUBLIC_API_URL` is the browser-visible backend origin baked at build
time; `API_INTERNAL_URL` is the server-side rewrite destination and points to
the private Compose backend service. Normal `npm run dev` and repository
`./run.sh` keep their localhost defaults and never require Docker.

## Related Docs

- [app/AGENTS.md](app/AGENTS.md) - Page-level rules
- [components/AGENTS.md](components/AGENTS.md) - Shared component rules
- [features/AGENTS.md](features/AGENTS.md) - Feature invariants
