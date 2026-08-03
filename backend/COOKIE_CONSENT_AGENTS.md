# Cookie Consent Implementation Guide (AI)

> **Scope:** Cookie/local-storage consent implementation across the frontend,
> authenticated backend persistence, and database schema.
>
> **Maintenance:** Update when storage keys, consent versioning, consent API
> behavior, policy UI, or persistence changes.

Use this guide whenever you modify cookie/local-storage behavior. Repository
identity, delivery, and safety rules are inherited from
[`../AGENTS.md`](../AGENTS.md). The maintained compliance boundary is
[`../docs/cookie-consent-compliance.md`](../docs/cookie-consent-compliance.md).

## Scope

- Frontend consent UX is in:
  - `frontend/features/cookie-consent/components/cookie-consent-manager.tsx`
  - `frontend/features/cookie-consent/utils/consent-storage.ts`
- Authenticated consent persistence is in:
  - `backend/app/features/auth/user_cookie_consent.py`
  - `backend/app/features/settings/router.py` (`/settings/user/cookie-consent`)
  - `backend/app/features/settings/service.py`
- DB source of truth:
  - Alembic revisions under `backend/alembic/versions/` (`auth.user_cookie_consents`)

## Compliance Baseline

- Never set non-essential cookies/storage before explicit opt-in.
- Keep first-layer actions symmetric:
  - `Accept necessary`
  - `Accept all`
- Do not use pre-ticked consent for non-essential storage.
- Keep consent withdrawal as easy as giving consent.
- Keep cookie disclosures updated:
  - `frontend/app/cookie-policy/page.tsx`
  - `frontend/app/privacy-policy/page.tsx`

## Storage Classification (Current)

- Strictly necessary:
  - `league_analysis_auth_state` (cookie)
  - `auth_access_token` (localStorage)
  - `auth_refresh_token` (localStorage)
  - `league_analysis_cookie_consent` (cookie)
- Optional preference storage:
  - `header_messages_closed` (localStorage)

If you add any new key:
1. classify it as strictly necessary vs optional,
2. gate optional keys via consent check,
3. update Cookie Policy table and this guide.

## Versioning Rule

- Current consent version is `v1` (`COOKIE_CONSENT_VERSION`).
- Bump the version when cookie categories or purposes change materially.
- When version changes:
  - expect re-prompting on next visit,
  - update cookie policy text and release notes/docs.

## Backend Rules

- Do not auto-create tables with SQLAlchemy.
- Keep schema changes in a reviewed Alembic revision.
- Apply incremental DB updates with `backend/scripts/migrate.py` in local/dev.
- Preserve user data and avoid destructive migrations unless requested.

## QA Checklist

1. No consent cookie -> banner appears.
2. `Accept necessary` -> optional storage is cleared/blocked.
3. `Accept all` -> optional storage can persist.
4. Authenticated consent updates persist to `auth.user_cookie_consents`.
5. `npm run lint`, `npx tsc --noEmit`, and `uv run pyright` all pass.
