# Frontend

Domain UI under `features/<name>/`, shared components under `components/`,
utilities under `lib/core/`. The two-TypeScript-package arrangement is
explained in
[`../docs/project-overview.md`](../docs/project-overview.md#technology).

- Always handle loading, error and success states. A failed fetch is never
  silent: the `QueryCache` in `components/providers.tsx` toasts every query
  error through `queryErrorToast`, so a call site reading only `data` still
  tells the viewer something went wrong. That is a floor, not a substitute —
  a surface that can render its own error inline should still do so.
- Opt a query out of that toast with `meta: { silenceErrorToast: true }`, or
  name the failure with `meta: { errorTitle: "…" }`. Silence is the exception
  and wants a comment saying which surface reports the failure instead.
