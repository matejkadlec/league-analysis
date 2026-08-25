"use client";

import { useEffect } from "react";

import { reportClientError } from "@/lib/core/client-error-report";

/**
 * Rendered for signed-out visitors too: gating it on authentication made a
 * render error on /sign-in an absorbing state, since the reset button lived
 * inside the thing that would not render. It sits inside the layout and so
 * does not cover the layout itself -- that is `global-error.tsx`.
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
