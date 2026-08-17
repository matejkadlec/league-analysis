"use client";

import { useAuth } from "@/features/auth";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading || !isAuthenticated) {
    return null;
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h2 className="text-2xl font-bold">This page could not be loaded</h2>
        <p className="mt-2 text-muted-foreground">
          Try again. If the problem continues, return to this page later.
        </p>
        <button
          type="button"
          onClick={() => reset()}
          className="mt-4 rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
