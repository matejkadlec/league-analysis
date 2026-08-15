# Frontend

Next.js App Router with shadcn/ui (New York). Domain UI under
`features/<name>/`, shared components under `components/`, utilities under
`lib/core/`. `package.json` is the version authority; the two-TypeScript-package
arrangement is explained in
[`../docs/project-overview.md`](../docs/project-overview.md#technology).

## Rules

- Interfaces for props.
- `"use client"` for hooks/events/browser APIs.
- TanStack Query for all data fetching: `validatedGet` + Zod schemas from
  `lib/core`; always handle loading/error/success states.
- Data Dragon version: resolve server-side via the cached manifest helper,
  consume with `useDDragonVersion()`; keep the reviewed fallback for unknown
  IDs.
- Features expose public APIs via `index.ts`.

## Design-system contract (product decisions, not suggestions)

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
- Toasts: sonner via the `useToast()` hook from `@/lib/core/hooks`. Always an
  explicit variant: `success` (failable operation completed), `error`
  (failed), `warning` (non-blocking degradation, cautious guidance, invalid
  input), `info` (neutral/queued/started/running) — never the default
  unstyled variant. Default duration 4000ms; `1000` only for quick inline
  confirmations.
- Normalize API failures through `lib/core/api-error.ts`: safe typed
  validation/business messages may surface, but never raw response bodies or
  unclassified exception text.

## Commands

`../test.sh -f` for the scoped gate; the rest are `package.json` scripts.
`rm -rf .next` clears a stale cache. Playwright needs
`npx playwright install chromium` once before `npm run test:e2e`.
