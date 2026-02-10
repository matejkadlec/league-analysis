# Cookie Consent Implementation Guide (AI)

Use this guide whenever you modify cookie/local-storage behavior in League Analysis.

## Scope

- Frontend consent UX is in:
  - `frontend/features/cookie-consent/components/cookie-consent-manager.tsx`
  - `frontend/features/cookie-consent/utils/consent-storage.ts`
- Authenticated consent persistence is in:
  - `backend/app/features/auth/user_cookie_consent.py`
  - `backend/app/features/settings/router.py` (`/settings/user/cookie-consent`)
  - `backend/app/features/settings/service.py`
- DB source of truth:
  - `backend/init_database.sql` (`auth.user_cookie_consents`)

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
- Keep schema changes in `backend/init_database.sql`.
- Apply incremental DB updates with `psql` in local/dev.
- Preserve user data and avoid destructive migrations unless requested.

## QA Checklist

1. No consent cookie -> banner appears.
2. `Accept necessary` -> optional storage is cleared/blocked.
3. `Accept all` -> optional storage can persist.
4. Authenticated consent updates persist to `auth.user_cookie_consents`.
5. `npm run lint`, `npx tsc --noEmit`, and `uv run pyright` all pass.
