# Frontend

Stack: Node (pinned by `.nvmrc`) + npm (pinned by `packageManager`), Next.js
App Router, React 19, TypeScript strict, Tailwind 4, shadcn/ui (New York),
TanStack Query v5, Zod v4, Axios, sonner, lucide-react, Vitest + Testing
Library + jsdom. Domain UI under `features/<name>/`, shared components under
`components/`, utilities under `lib/core/`. The `typescript` npm package is a
TypeScript 6 compatibility alias for ESLint while the native TypeScript 7
compiler supplies `tsc` — Next's TypeScript API mode stays enabled.

## Rules

- TypeScript strict (no `any`), interfaces for props, kebab-case files,
  PascalCase components.
- `"use client"` for hooks/events/browser APIs.
- TanStack Query for all data fetching: `validatedGet` + Zod schemas from
  `lib/core`; always handle loading/error/success states.
- Data Dragon version: resolve server-side via the cached manifest helper,
  consume with `useDDragonVersion()`; keep the reviewed fallback for unknown
  IDs.
- Features expose public APIs via `index.ts`. Use Next.js `proxy.ts` (not
  `middleware.ts`).

## Design-system contract (product decisions, not suggestions)

- Every interactive element has `cursor: pointer` — enforced globally via
  `globals.css`.
- Branded classes from `globals.css` over inline Tailwind: `.gold-gradient`
  (primary CTA), `.red-gradient` (destructive/cancel), `.blue-gradient`
  (neutral/secondary), `.button-small/medium/full`, `.icon-circle`,
  `.dialog-white-border`, `.vertical-gradient`.
- Dialogs: shadcn `Dialog` + `DialogContent` with `dialog-white-border`,
  default close interactions kept, global 1:2 top-to-bottom vertical position
  kept (do not center or override). Title includes a lucide icon with
  `h-5 w-5 text-[#cfa93a]`; all buttons `py-2 px-4`; footer
  `flex items-center justify-between gap-2` with Cancel left (`red-gradient`
  + `StopCircle`, mandatory app-wide) and submit CTA right (`button-medium
  no-rotation` or `gold-gradient` + icon). Validation errors sit directly
  under the related field.
- Toasts: sonner via the `useToast()` hook from `@/lib/core/hooks` — only
  that adapter and the shared `ToastHost` import sonner directly. Always an
  explicit variant: `success` (failable operation completed), `error`
  (failed), `warning` (non-blocking degradation, cautious guidance, invalid
  input), `info` (neutral/queued/started/running) — never the default
  unstyled variant. Default duration 4000ms; `1000` only for quick inline
  confirmations.
- Normalize API failures through `lib/core/api-error.ts`: safe typed
  validation/business messages may surface, but never raw response bodies or
  unclassified exception text.

## Commands

`../test.sh -f`, `npm run dev`, `npm run lint`, `npm run typecheck`,
`npm test`, `npm run build`, `rm -rf .next` (clear cache). Playwright:
`npx playwright install chromium` once, then `npm run test:e2e`.
