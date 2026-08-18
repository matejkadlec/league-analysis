"use client";

import { useEffect, useReducer, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/features/auth";
import {
  hasAuthStateCookie,
  subscribeToAuthStateCookie,
} from "@/features/auth/utils/auth-state-cookie";

const PUBLIC_ROUTES = [
  "/sign-in",
  "/join-us",
  "/privacy-policy",
  "/cookie-policy",
  "/license",
];

interface AuthGateProps {
  children: React.ReactNode;
}

/**
 * Shown when the session hint says a session exists but the API could not be
 * asked whether it is still valid.
 *
 * This state has to render something. Redirecting is wrong — `proxy.ts` routes
 * on the same hint and would send the visitor straight back, and an
 * unreachable server is not evidence the session ended. Rendering nothing is
 * how this component produced a permanently blank page: no route change, no
 * message, and nothing to click, because the one thing that would re-check
 * runs only on mount.
 */
function SessionUnverified({
  onRetry,
  onSignOut,
}: {
  onRetry: () => void;
  onSignOut: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-md text-center">
        <h1 className="text-lg font-semibold text-foreground">
          Can&apos;t reach the server
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your session could not be confirmed. This is usually a connection
          problem rather than a signed-out session.
        </p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md border border-border px-4 py-2 text-sm transition-colors hover:bg-muted"
          >
            Try again
          </button>
          {/* The only way out when the failure is permanent rather than
              transient -- a 500 on this one account, say. Retrying takes the
              same branch forever, `proxy.ts` sends /sign-in back here while
              the hint lives, and the sidebar's Sign Out button is not drawn
              for a visitor who is not authenticated. Without this the visitor
              is stuck on this screen until they clear the cookie by hand. */}
          <button
            type="button"
            onClick={onSignOut}
            className="rounded-md px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Client render gate. Route-level redirects live in `proxy.ts` so the wrong
 * page never flashes before navigation.
 *
 * Every branch here decides on the hint cookie as well as on React state,
 * because `proxy.ts` decides on that cookie alone. Where the two disagree is
 * exactly where a page used to render nothing — the server admitting a visitor
 * the client would not draw, or bouncing one the client thought was fine.
 */
export function AuthGate({ children }: AuthGateProps) {
  const { isAuthenticated, isLoading, checkAuth, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  // The cookie is not reactive and nothing subscribes to it, so a re-check
  // that lands on the state already held changes nothing React can see. This
  // forces the re-read after a retry, which is what lets a check that
  // discovers a dead session act on it instead of leaving the retry surface
  // up for good.
  const [recheckCount, forceRecheck] = useReducer((n: number) => n + 1, 0);

  // Subscribed rather than read during render: the cookie changes without any
  // React state changing, so a gate that only read it at render time kept
  // drawing the signed-in shell after the interceptor had given the session
  // up.
  const hasSessionHint = useSyncExternalStore(
    subscribeToAuthStateCookie,
    hasAuthStateCookie,
    () => false,
  );
  const isPublicRoute = PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
  const isSignInRoute =
    pathname === "/sign-in" || pathname.startsWith("/sign-in/");

  // Both halves have to agree before protected content is drawn. The hint
  // alone is not proof (it outlives its session), and React state alone goes
  // stale — the axios interceptor can tear a session down without the context
  // hearing about it, which left the signed-in UI up over an API that refused
  // every call.
  const isSignedIn = isAuthenticated && hasSessionHint;

  // Redirect only once the hint is gone. While it is set, `proxy.ts` sends
  // /sign-in back to / on that same cookie, so redirecting now would bounce
  // the visitor between the two forever. Waiting for the hint is also what
  // separates a rejected session from a server that could not be reached.
  const isSignedOutOnProtectedRoute =
    !isLoading && !hasSessionHint && !isPublicRoute && !isSignInRoute;

  useEffect(() => {
    if (isSignedOutOnProtectedRoute) {
      router.replace("/sign-in");
    }
    // `recheckCount` is a dependency so a retry re-runs this even when every
    // other input is unchanged.
  }, [isSignedOutOnProtectedRoute, router, recheckCount]);

  if (isSignInRoute) {
    // Hide the form only while the hint agrees a session is current, since
    // that is the only case where `proxy.ts` is about to redirect away.
    return isSignedIn ? null : <>{children}</>;
  }

  if (isPublicRoute) {
    return <>{children}</>;
  }

  if (isSignedIn) {
    return <>{children}</>;
  }

  if (isLoading || isSignedOutOnProtectedRoute) {
    // Either still resolving, or the effect above is navigating away.
    return null;
  }

  // Hint present, session unconfirmed: the server could not be reached.
  return (
    <SessionUnverified
      onRetry={() => {
        void Promise.resolve(checkAuth()).finally(forceRecheck);
      }}
      onSignOut={() => {
        void Promise.resolve(logout()).finally(forceRecheck);
      }}
    />
  );
}
