"use client";

import { useEffect, useState } from "react";

/**
 * The value, held back until it has stopped changing for `delayMs`. It feeds a
 * query key, so the point is fewer requests, not a smoother render --
 * `useDeferredValue` would still fetch on every keystroke. Debounced as the
 * caller passes it: trimming inside the timeout restarts it on a stray space.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timeoutId);
  }, [value, delayMs]);

  return debounced;
}
