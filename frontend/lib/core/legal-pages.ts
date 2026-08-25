/**
 * The legal pages, listed once: the public footer, the sidebar footer and
 * `app/sitemap.ts` each referenced this set, and a page missing from the
 * sitemap is invisible rather than broken. Not `PUBLIC_ROUTES`, which answers
 * a different question -- what a signed-out visitor may reach.
 */
export const LEGAL_PAGES = [
  { href: "/license", label: "License" },
  { href: "/privacy-policy", label: "Privacy Policy" },
  { href: "/cookie-policy", label: "Cookie Policy" },
] as const;
