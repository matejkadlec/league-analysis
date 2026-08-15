# Pages (app/)

- A new page must also be registered in `components/sidebar-nav.tsx`.
- `/jobs` is admin-only. Public policy pages (`/license`, `/privacy-policy`,
  `/cookie-policy`) serve signed-in and signed-out layouts at the same URL;
  signed-in users are redirected away from `/sign-in`.
