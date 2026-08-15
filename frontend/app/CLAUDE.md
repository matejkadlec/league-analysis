# Pages (app/)

- Add new pages to `components/sidebar-nav.tsx`; use the container pattern
  `container mx-auto py-8`.
- Player Overview and Match History consume the shared current-player context —
  never restore duplicated large Player Search cards.
- `/my-profile` and `/playstyle-analysis` are PUUID-preserving compatibility
  redirects, not destinations. Retired `/tracked-players` stays a safe redirect
  preserving a supplied PUUID; tracked-player management lives in the sidebar
  dialog.
- `/jobs` is admin-only. Public policy pages (`/license`, `/privacy-policy`,
  `/cookie-policy`) serve signed-in and signed-out layouts at the same URL;
  signed-in users are redirected away from `/sign-in`.
