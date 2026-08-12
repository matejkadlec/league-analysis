# Pages (`app/`)

> **Scope:** Page-level rules under `frontend/app/`.
>
> **Maintenance:** Update when a page-level rule or access invariant changes.
> The route inventory and app-level files live in the code.

Inherits repository-wide rules from [`../../AGENTS.md`](../../AGENTS.md) and
frontend rules from [`../AGENTS.md`](../AGENTS.md).

## Rules

- Add `"use client"` for hooks, browser APIs, event handlers; always handle
  loading/error/success states.
- Add new pages to `components/sidebar-nav.tsx`.
- Use the container pattern: `<div className="container mx-auto py-8">`.
- My Profile and Playstyle Analysis consume the shared current-player context;
  they must not restore duplicated large Player Search cards. Preserve
  `?puuid=` for deep links, history, and independent browser tabs — the
  explicit URL PUUID is authoritative for the current tab.
- Tracked-player management lives in the sidebar dialog. Keep the retired
  `/tracked-players` route as a safe redirect and preserve a supplied PUUID.
- `/jobs` is admin-only. Public routes (`/license`, `/privacy-policy`,
  `/cookie-policy`) serve signed-in and signed-out layouts at the same URL;
  signed-in users are redirected away from `/sign-in`.
