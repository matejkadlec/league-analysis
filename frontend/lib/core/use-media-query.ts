"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether a CSS media query currently matches. `useSyncExternalStore` rather
 * than state-plus-effect: it subscribes and takes a server snapshot, so there
 * is no hydration mismatch. That snapshot is `false` -- match is enhancement.
 */
export function useMediaQuery(query: string): boolean {
  // Memoised on the query: an inline subscribe would be a new function every
  // render, and `useSyncExternalStore` tears the listener down and re-creates
  // it whenever it changes identity.
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onStoreChange);
      return () => list.removeEventListener("change", onStoreChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * Tailwind's `lg` breakpoint, where the fixed-width desktop layout starts.
 * `rem`, not `px`: Tailwind v4 compiles `lg:` to `@media (width >= 64rem)`, so
 * `1024px` agrees with the stylesheet only at a 16px root font size.
 */
export const LG_BREAKPOINT_QUERY = "(min-width: 64rem)";
