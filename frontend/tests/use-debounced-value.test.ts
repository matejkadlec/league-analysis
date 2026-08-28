// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

import { useDebouncedValue } from "@/lib/core/use-debounced-value";

/**
 * The hook runs unmocked inside `match-list-region.test.tsx`, but nothing
 * there asserts the window itself. These are the edges that make it a
 * debounce rather than a delay.
 */

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useDebouncedValue", () => {
  it("holds the new value back for the full delay", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 300),
      { initialProps: { value: "a" } },
    );

    expect(result.current).toBe("a");

    rerender({ value: "ab" });
    expect(result.current).toBe("a");

    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(result.current).toBe("a");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe("ab");
  });

  it("restarts the window on a change inside it, never emitting the middle", () => {
    // The whole point: typing "abc" one character at a time must produce one
    // value, not three. A plain delay would emit "ab" here.
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 300),
      { initialProps: { value: "a" } },
    );

    rerender({ value: "ab" });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    rerender({ value: "abc" });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(result.current).toBe("a");

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe("abc");
  });

  it("leaves no timer running after it unmounts", () => {
    // Without the cleanup the callback fires into an unmounted component.
    vi.useFakeTimers();
    const { rerender, unmount } = renderHook(
      ({ value }) => useDebouncedValue(value, 300),
      { initialProps: { value: "a" } },
    );

    rerender({ value: "ab" });
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
