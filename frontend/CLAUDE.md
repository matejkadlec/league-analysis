# Frontend

Domain UI under `features/<name>/`, shared components under `components/`,
utilities under `lib/core/`. The two-TypeScript-package arrangement is
explained in
[`../docs/project-overview.md`](../docs/project-overview.md#technology).

- Always handle loading, error and success states. Deliberately prose: 28 of
  the 35 `useQuery` call sites never read the error state, so a gate would
  start as an allowlist of nearly every caller — and reading `error` is not
  evidence of rendering it.
