# Frontend

Domain UI under `features/<name>/`, shared components under `components/`,
utilities under `lib/core/`. The two-TypeScript-package arrangement is
explained in
[`../docs/project-overview.md`](../docs/project-overview.md#technology).

- TanStack Query for all data fetching: `validatedGet` + Zod schemas from
  `lib/core`; always handle loading, error and success states.
- Data Dragon version: resolve server-side via the cached manifest helper,
  consume with `useDDragonVersion()`; keep the reviewed fallback for unknown
  IDs.
- `globals.css` branded classes carry product decisions — `.gold-gradient`
  (primary), `.red-gradient` (destructive), `.blue-gradient` (neutral), the
  `.button-*` sizes, `.icon-circle`, `.dialog-white-border`. Read a
  neighbouring dialog or card before writing inline Tailwind for the same job.
