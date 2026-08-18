"use client";

import {
  useEffect,
  useReducer,
  useState,
  useSyncExternalStore,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/features/auth";
import {
  hasAuthStateCookie,
  subscribeToAuthStateCookie,
} from "@/features/auth/utils/auth-state-cookie";

/**
 * How long the screen may stay empty before it owes the visitor a word.
 *
 * Long enough that a healthy probe never reaches it, short enough that
 * nobody concludes the page is broken.
 */
export const SLOW_PROBE_NOTICE_MS = 600;

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
/**
 * Nothing at all for the first moment, then an explanation.
 *
 * The delay is the point: a probe that answers promptly is the normal case,
 * and flashing a message on every page load would be worse than the silence
 * it replaces.
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

function SessionUnverified({
  onRetry,
  onSignOut,
}: {
  onRetry: () => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  // Both actions can take the full probe deadline, and this surface exists
  // precisely for the server that is not answering -- so both will regularly
  // run the whole ten seconds. Without a pending state nothing on screen
  // moves in that time: `checkAuth` deliberately never raises `isLoading`,
  // and `logout` clears nothing until its request settles. The visitor reads
  // that as a dead button and clicks again, stacking another probe each time.
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
          {/* The only way out when the failure is permanent rather than
              transient -- a 500 on this one account, say. Retrying takes the
              same branch forever, `proxy.ts` sends /sign-in back here while
              the hint lives, and the sidebar's Sign Out button is not drawn
              for a visitor who is not authenticated. Without this the visitor
              is stuck on this screen until they clear the cookie by hand. */}
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
    // Either still resolving, or the effect above is navigating away. The
    // usual probe settles in milliseconds and nobody should see anything --
    // but a backend that accepts the connection and then hangs takes the full
    // ten-second deadline, and twice that when a refresh is honoured and the
    // second probe hangs too. This gate wraps the entire layout, so all of
    // that time is a white page with no header, no spinner and nothing to
    // read: the reported symptom exactly, just time-boxed. Say something once
    // it has gone on long enough to look broken.
    return <SlowProbe />;
  }

  // Hint present, session unconfirmed: the server could not be reached.
  return (
    <SessionUnverified
      onRetry={() => Promise.resolve(checkAuth()).finally(forceRecheck)}
      onSignOut={() => Promise.resolve(logout()).finally(forceRecheck)}
    />
  );
}
