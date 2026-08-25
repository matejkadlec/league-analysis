/**
 * The routes a visitor may read without a session. One list, because two
 * copies drifted and left a legally required page unreachable to signed-out
 * visitors. `proxy.ts` may import only this directory, so nothing here may
 * ever reach for the network.
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
