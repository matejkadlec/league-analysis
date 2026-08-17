"use client";

import { useAuth } from "../context/auth-context";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
}

export function ProtectedRoute({
  children,
  requireAdmin = false,
}: ProtectedRouteProps) {
  const { user, isAuthenticated, isLoading } = useAuth();

  if (isLoading || !isAuthenticated) {
    return null;
  }

  if (requireAdmin && user && !user.is_admin) {
    return null;
  }

  if (user && !user.is_active) {
    return null;
  }

  return <>{children}</>;
}
