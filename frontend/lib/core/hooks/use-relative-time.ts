"use client";

import { useEffect, useState } from "react";

import { formatRelativeTime } from "@/lib/core/relative-time";

const RELATIVE_TIME_TICK_MS = 30_000;

export function useRelativeTime(value: string | null | undefined): string {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(
      () => setNow(Date.now()),
      RELATIVE_TIME_TICK_MS,
    );
    return () => window.clearInterval(interval);
  }, [value]);

  return formatRelativeTime(value, now);
}
