"use client";

import { useEffect, useState } from "react";

/**
 * Feeds a query key, so the point is fewer requests -- `useDeferredValue` would
 * still fetch on every keystroke. Trimming inside the timeout would restart it.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timeoutId);
  }, [value, delayMs]);

  return debounced;
}
