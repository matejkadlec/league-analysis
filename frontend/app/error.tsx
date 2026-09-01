"use client";

import { useEffect } from "react";

import { reportClientError } from "@/lib/core/http/client-error-report";

/**
 * Never gate this on authentication: the reset button would sit inside the
 * thing that failed to render. The layout itself: `global-error.tsx`.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError({
      kind: "react",
      message: error.message,
      source: "boundary",
    });
  }, [error]);

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
