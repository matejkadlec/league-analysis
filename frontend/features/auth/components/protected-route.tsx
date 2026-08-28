"use client";

import { useAuth } from "../context/auth-context";
import { ACCOUNT_INACTIVE_MESSAGE } from "@/lib/session/login-error";

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

  // Being refused is a state the visitor can be in for good, so it has to say
  // so: unlike a missing session, nothing they can do will ever change it.
  if (requireAdmin && user && !user.is_admin) {
    return <AccessDenied reason="This page is limited to administrators." />;
  }

  if (user && !user.is_active) {
    return (
      <AccessDenied reason={ACCOUNT_INACTIVE_MESSAGE} />
    );
  }

  return <>{children}</>;
}

function AccessDenied({ reason }: { reason: string }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-md text-center">
        <h1 className="text-lg font-semibold text-foreground">
          You don&apos;t have access to this page
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{reason}</p>
      </div>
    </div>
  );
}
