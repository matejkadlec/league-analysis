"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/features/auth";

// Routes that don't require authentication
const PUBLIC_ROUTES = ["/sign-in", "/privacy-policy", "/license"];

interface AuthGateProps {
  children: React.ReactNode;
}

/**
 * Global authentication gate that protects all routes.
 * Redirects unauthenticated users to /sign-in for all protected routes.
 * This prevents any flash of protected content (including 404 pages).
 */
export function AuthGate({ children }: AuthGateProps) {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const isPublicRoute = PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );

  // Redirect to sign-in if not authenticated and not on a public route
  useEffect(() => {
    if (!isLoading && !isAuthenticated && !isPublicRoute) {
      router.replace("/sign-in");
    }
  }, [isLoading, isAuthenticated, isPublicRoute, router]);

  // If on a public route, always render children
  if (isPublicRoute) {
    return <>{children}</>;
  }

  // While loading, render nothing to prevent flash
  if (isLoading) {
    return null;
  }

  // If not authenticated, render nothing (redirect will happen via useEffect)
  if (!isAuthenticated) {
    return null;
  }

  // Authenticated - render children
  return <>{children}</>;
}
