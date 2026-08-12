# Profile Feature (`features/profile/`)

> **Scope:** Intentional behaviors of the My Profile statistics cards under
> `frontend/features/profile/`.
>
> **Maintenance:** Update when an intentional card behavior changes. Component
> internals, displayed fields, and endpoint usage live in the code.

Inherits repository-wide rules from
[`../../../AGENTS.md`](../../../AGENTS.md), frontend rules from
[`../../AGENTS.md`](../../AGENTS.md), and feature conventions from
[`../AGENTS.md`](../AGENTS.md).

Intentional behaviors (regression-protected — the Vitest suite covers the
Top Champions pagination boundaries and the Playwright suite covers its
browser interaction):

- Top Champions shows exactly five champion rows per local page with a stable
  card height on a partial final page; the backend returns the complete
  ordered aggregate and the card paginates locally.
- Win-rate color coding: green >55%, yellow 50–55%, red <50%.
- Cards show an updated timestamp sourced per the freshness rules in
  [`../AGENTS.md`](../AGENTS.md).
- The LGA-23/LGA-25 configurable-card contract for these cards is
  [`../../../docs/card-configuration.md`](../../../docs/card-configuration.md).
