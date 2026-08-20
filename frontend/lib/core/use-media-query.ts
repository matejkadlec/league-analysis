"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether a CSS media query currently matches.
 *
 * `useSyncExternalStore` rather than state-plus-effect: it subscribes to the
 * `MediaQueryList` directly and takes a server snapshot, so there is no
 * first-paint flash of the wrong branch and no hydration mismatch. The server
 * snapshot is `false` — treat the matched branch as the enhancement.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onStoreChange);
      return () => list.removeEventListener("change", onStoreChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Tailwind's `lg` breakpoint, where the fixed-width desktop layout starts. */
export const LG_BREAKPOINT_QUERY = "(min-width: 1024px)";
