"use client";

import { usePathname } from "next/navigation";
import { useAuth } from "@/features/auth";

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

  const isPublicRoute = PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
  const isSignInRoute =
    pathname === "/sign-in" || pathname.startsWith("/sign-in/");

  if (isSignInRoute) {
    if (isAuthenticated) {
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
