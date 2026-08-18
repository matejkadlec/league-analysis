"use client";

/**
 * Rendered for signed-out visitors too.
 *
 * This covers the page segment, including /sign-in and every other public
 * route. Gating it on authentication made a render error there an absorbing
 * state: the page went blank, the reset button was inside the thing that was
 * not rendering, and the visitor could not sign in — so they could never
 * become authenticated and the boundary could never appear.
 *
 * It sits inside the layout, so it does not cover the layout itself. That is
 * `global-error.tsx`.
 */
export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
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
