// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  formatRelativeTime,
  oldestCompleteFreshness,
} from "@/lib/core/relative-time";
import { useRelativeTime } from "@/lib/core/use-relative-time";

describe("authoritative freshness presentation", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("uses the oldest required source for a multi-source card", () => {
    expect(
      oldestCompleteFreshness([
        "2026-08-09T12:00:00Z",
        "2026-08-09T11:00:00Z",
        "2026-08-09T13:00:00Z",
      ]),
    ).toBe("2026-08-09T11:00:00Z");
    expect(oldestCompleteFreshness(["2026-08-09T12:00:00Z", null])).toBeNull();
  });

  it("ages relative text while the page remains open", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T12:00:30Z"));
    const syncedAt = "2026-08-09T12:00:00Z";
    const { result } = renderHook(() => useRelativeTime(syncedAt));

    expect(result.current).toBe("just now");
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe("1 minute ago");
  });

  it("does not interpret future timestamps as stale", () => {
    expect(
      formatRelativeTime(
        "2026-08-09T12:01:00Z",
        new Date("2026-08-09T12:00:00Z").getTime(),
      ),
    ).toBe("just now");
  });
});
