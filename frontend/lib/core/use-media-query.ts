"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether a CSS media query currently matches.
 *
 * `useSyncExternalStore` rather than state-plus-effect: it subscribes to the
 * `MediaQueryList` directly and takes a server snapshot, so there is no
 * first-paint flash of the wrong branch and no hydration mismatch. The server
 * snapshot is `false` — treat the matched branch as the enhancement.
 */
export function useMediaQuery(query: string): boolean {
  // Memoised on the query: an inline subscribe would be a new function every
  // render, and `useSyncExternalStore` tears the listener down and re-creates
  // it whenever it changes identity. Consumers here re-render on every
  // keystroke of a debounced search.
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
 *
 * `rem`, not `px`: Tailwind v4 compiles `lg:` to `@media (width >= 64rem)`,
 * resolved against the root font size. Written as `1024px` this agrees with
 * the stylesheet only at a 16px default — a visitor who has raised their
 * browser font size would get the hook flipping at a different width than
 * the `lg:` class it exists to track.
 */
export const LG_BREAKPOINT_QUERY = "(min-width: 64rem)";
