"use client";

import Link from "next/link";

/**
 * Rendered for signed-out visitors too. Returning null unless authenticated
 * made every unmatched path under a public prefix a blank page, and
 * `/sign-in/anything` is reachable with no setup at all. A 404 notice reveals
 * nothing worth gating.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h2 className="text-2xl font-bold">This page does not exist</h2>
        <p className="mt-2 text-muted-foreground">
          Check the address, or head back to the home page.
        </p>
        <Link
          href="/"
          className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90"
        >
          Go to home page
        </Link>
      </div>
    </div>
  );
}
