/**
 * The legal pages, listed once.
 *
 * Three places rendered or referenced this set independently -- the public
 * footer, the sidebar footer and `app/sitemap.ts` -- so adding a fourth legal
 * page meant remembering three edits, and a page missing from the sitemap is
 * invisible rather than broken.
 *
 * Not to be confused with `page-navigation-contract.test.ts`'s own
 * `PUBLIC_ROUTES`, which answers a different question: what a signed-out
 * visitor may reach, sign-in and join-us included.
 */
export const LEGAL_PAGES = [
  { href: "/license", label: "License" },
  { href: "/privacy-policy", label: "Privacy Policy" },
  { href: "/cookie-policy", label: "Cookie Policy" },
] as const;
