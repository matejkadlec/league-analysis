"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/features/auth";
import { hasAuthStateCookie } from "@/features/auth/utils/auth-state-cookie";

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
 * Client render gate. Route-level redirects live in `proxy.ts` so the wrong
 * page never flashes before navigation.
 */
export function AuthGate({ children }: AuthGateProps) {
  const { isAuthenticated, isLoading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const isPublicRoute = PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
  const isSignInRoute =
    pathname === "/sign-in" || pathname.startsWith("/sign-in/");

  // Both branches below decide on the hint cookie rather than on React state
  // alone, because `proxy.ts` decides on the hint too. Where the two disagree
  // is precisely where a page renders nothing: the server admits a visitor the
  // client will not draw, or bounces one the client thinks is fine.
  const hasSessionHint = hasAuthStateCookie();

  // Only the API can say whether a session is still honoured. When it says no,
  // the teardown clears the hint — so waiting for the hint to go is what
  // separates "rejected" from "could not reach the server". Redirecting on the
  // latter would fight `proxy.ts`, which sends /sign-in back to / while the
  // hint is set, and the two would bounce the visitor forever.
  const isStrandedOnProtectedRoute =
    !isLoading &&
    !isAuthenticated &&
    !hasSessionHint &&
    !isPublicRoute &&
    !isSignInRoute;

  useEffect(() => {
    if (isStrandedOnProtectedRoute) {
      router.replace("/sign-in");
    }
  }, [isStrandedOnProtectedRoute, router]);

  if (isSignInRoute) {
    // Hiding the form is only right when `proxy.ts` is about to redirect away
    // from it, and it only does that while the hint is set. Without this the
    // interceptor could clear the hint while React still believed it was
    // signed in, leaving the sign-in page blank.
    if (isAuthenticated && hasSessionHint) {
      return null;
    }
    return <>{children}</>;
  }

  if (isPublicRoute) {
    return <>{children}</>;
  }

  if (isLoading || !isAuthenticated) {
    return null;
  }

  return <>{children}</>;
}
