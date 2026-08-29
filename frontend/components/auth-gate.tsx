"use client";

import { useEffect, useReducer, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/features/auth";
import {
  hasAuthStateCookie,
  subscribeToAuthStateCookie,
} from "@/lib/session/auth-state-cookie";
// oxlint-disable-next-line no-restricted-imports -- shell infra bound to the public-route list; tests/auth-stranded-session.test.tsx asserts this behaviour
import { isPublicRoute as pathnameIsPublic } from "@/features/auth/public-routes";

/**
 * How long the screen may stay empty before it owes the visitor a word: long
 * enough that a healthy probe never reaches it, short enough that nobody
 * concludes the page is broken.
 */
export const SLOW_PROBE_NOTICE_MS = 600;

interface AuthGateProps {
  children: React.ReactNode;
}

/**
 * Nothing at all for the first moment, then an explanation. The delay is the
 * point: the healthy probe answers well inside it, and a message flashed on
 * every page load would be worse than the silence it replaces.
 */
function SlowProbe() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), SLOW_PROBE_NOTICE_MS);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) {
    return null;
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <p className="text-sm text-muted-foreground">
        Checking your session&hellip;
      </p>
    </div>
  );
}

/**
 * Hint says signed in, the API could not be asked. This branch must render
 * something: redirecting bounces off `proxy.ts`, and rendering nothing is the
 * permanently blank page this component once shipped.
 */
function SessionUnverified({
  onRetry,
  onSignOut,
}: {
  onRetry: () => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  // Both actions regularly run the whole ten-second probe deadline without
  // moving anything on screen, so without a pending state the visitor stacks
  // a probe per impatient click.
  const [pending, setPending] = useState<"retry" | "signOut" | null>(null);
  const run = (which: "retry" | "signOut", action: () => Promise<void>) => {
    setPending(which);
    void action().finally(() => setPending(null));
  };

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
            onClick={() => run("retry", onRetry)}
            disabled={pending !== null}
            className="rounded-md border border-border px-4 py-2 text-sm transition-colors hover:bg-muted disabled:opacity-60"
          >
            {pending === "retry" ? "Checking…" : "Try again"}
          </button>
          {/* The only way out of a permanent failure: retry takes the same
              branch forever, and `proxy.ts` sends /sign-in back here while
              the hint lives. */}
          <button
            type="button"
            onClick={() => run("signOut", onSignOut)}
            disabled={pending !== null}
            className="rounded-md px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted disabled:opacity-60"
          >
            {pending === "signOut" ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Client render gate; route-level redirects live in `proxy.ts`. Every branch
 * below reads the hint cookie as well as React state, because the edge decides
 * on that cookie alone.
 */
export function AuthGate({ children }: AuthGateProps) {
  const { isAuthenticated, isLoading, checkAuth, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  // A re-check landing on the state already held changes nothing React can
  // see. Forcing the cookie re-read is what lets a retry that discovers a
  // dead session act on it instead of leaving this surface up for good.
  const [recheckCount, forceRecheck] = useReducer((n: number) => n + 1, 0);

  // Subscribed rather than read during render: the cookie changes without any
  // React state changing, so reading it at render time keeps the signed-in
  // shell drawn after the interceptor has given the session up.
  const hasSessionHint = useSyncExternalStore(
    subscribeToAuthStateCookie,
    hasAuthStateCookie,
    () => false,
  );
  const isPublicRoute = pathnameIsPublic(pathname);
  const isSignInRoute =
    pathname === "/sign-in" || pathname.startsWith("/sign-in/");

  // Both halves must agree before protected content is drawn: the hint
  // outlives its session, and React state goes stale when the axios
  // interceptor tears a session down without the context hearing about it.
  const isSignedIn = isAuthenticated && hasSessionHint;

  // Redirect only once the hint is gone. While it is set, `proxy.ts` sends
  // /sign-in back to / on that same cookie, so redirecting now would bounce
  // the visitor between the two forever.
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
    // Still resolving, or the effect above is navigating away. A backend that
    // accepts and then hangs burns the full ten-second deadline, and this gate
    // wraps the whole layout -- so time-box the silence rather than serve it.
    return <SlowProbe />;
  }

  // Hint present, session unconfirmed: the server could not be reached.
  return (
    <SessionUnverified
      onRetry={() => Promise.resolve(checkAuth()).finally(forceRecheck)}
      onSignOut={() =>
        Promise.resolve(
          logout({ evenIfTheServerCannotBeReached: true }),
        ).finally(forceRecheck)
      }
    />
  );
}
