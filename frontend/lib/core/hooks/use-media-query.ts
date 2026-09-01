"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether a CSS media query currently matches. The server snapshot is
 * `false`, so a match is enhancement and hydration cannot mismatch.
 */
export function useMediaQuery(query: string): boolean {
  // Memoised: `useSyncExternalStore` re-subscribes whenever this changes
  // identity.
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
 * Tailwind's `lg` breakpoint. `rem`, not `px`: Tailwind v4 emits `64rem`,
 * which `1024px` agrees with only at a 16px root font size.
 */
export const LG_BREAKPOINT_QUERY = "(min-width: 64rem)";
