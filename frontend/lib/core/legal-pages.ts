/**
 * The legal pages, listed once. Not `PUBLIC_ROUTES`, which answers a different
 * question -- what a signed-out visitor may reach.
 */
export const LEGAL_PAGES = [
  { href: "/license", label: "License" },
  { href: "/privacy-policy", label: "Privacy Policy" },
  { href: "/cookie-policy", label: "Cookie Policy" },
] as const;
