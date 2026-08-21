"use client";

import { useEffect, useState } from "react";

/**
 * The value, held back until it has stopped changing for `delayMs`.
 *
 * Both search boxes here feed a query key, so the point is fewer requests, not
 * a smoother render -- `useDeferredValue` would re-prioritise the render and
 * still fetch on every keystroke.
 *
 * The value is debounced as the caller passes it, already trimmed. Trimming
 * inside the timeout instead restarts the timer for a trailing space that
 * cannot change the result.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timeoutId);
  }, [value, delayMs]);

  return debounced;
}
