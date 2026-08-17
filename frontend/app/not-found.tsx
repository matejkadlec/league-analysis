"use client";

import { useAuth } from "@/features/auth";

export default function NotFound() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading || !isAuthenticated) {
    return null;
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h2 className="text-2xl font-bold">404 - Page Not Found</h2>
        <p className="mt-2 text-muted-foreground">
          The page you are looking for does not exist.
        </p>
      </div>
    </div>
  );
}
