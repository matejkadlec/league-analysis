/**
 * The routes a visitor may read without a session, and the one test for them.
 *
 * Two copies of this list existed, one in `proxy.ts` and one in
 * `auth-gate.tsx`, with the same `some(...)` check written out twice. The
 * proxy's copy is swept entry by entry by `proxy-session-hint.test.ts`; the
 * gate's had exactly one of its five entries pinned, so dropping
 * `/cookie-policy` from it left the whole suite green -- and a signed-out
 * visitor clicking Cookie Policy in the consent banner would have been
 * redirected to /sign-in, with a legally required page unreadable to the
 * people most likely to want it.
 *
 * A test for the second copy would have caught that. One list cannot drift
 * from itself, which is better.
 *
 * `proxy.ts` may import only `next/server` and this directory (enforced by an
 * allowlist in `eslint.config.mjs`, because the edge must make no requests),
 * so this file exists to hold constants and must never reach for the network.
 */
export const PUBLIC_ROUTES = [
  "/sign-in",
  "/join-us",
  "/privacy-policy",
  "/cookie-policy",
  "/license",
];

/** Prefix match, so `/privacy-policy/full` is public too. */
export function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}
