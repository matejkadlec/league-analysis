// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";

import { LG_BREAKPOINT_QUERY, useMediaQuery } from "@/lib/core/use-media-query";

/**
 * `match-list-region.test.tsx` runs this hook with a stubbed `matchMedia` but
 * never changes the match, so neither the subscription nor the server
 * snapshot is asserted anywhere.
 */

function stubMatchMedia(matches: boolean) {
  const listeners = new Set<() => void>();
  const list = {
    matches,
    addEventListener: (_: string, listener: () => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_: string, listener: () => void) => {
      listeners.delete(listener);
    },
  };
  vi.stubGlobal("matchMedia", () => list);
  return {
    listenerCount: () => listeners.size,
    change(next: boolean) {
      list.matches = next;
      act(() => listeners.forEach((listener) => listener()));
    },
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useMediaQuery", () => {
  it("reports the current match and follows the change event", () => {
    const media = stubMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery(LG_BREAKPOINT_QUERY));

    expect(result.current).toBe(false);

    media.change(true);
    expect(result.current).toBe(true);

    media.change(false);
    expect(result.current).toBe(false);
  });

  it("leaves no listener behind when it unmounts", () => {
    // A page of rows mounting and unmounting these would otherwise accumulate
    // one live listener per mount for the lifetime of the tab.
    const media = stubMatchMedia(true);
    const { unmount } = renderHook(() => useMediaQuery(LG_BREAKPOINT_QUERY));

    expect(media.listenerCount()).toBe(1);
    unmount();
    expect(media.listenerCount()).toBe(0);
  });

  it("takes false as its server snapshot, so hydration cannot mismatch", () => {
    // The one assertion no client-side render can make. `matchMedia` does not
    // exist on the server, so a snapshot that consulted it would throw --
    // and one that guessed `true` would swap the layout on hydration.
    vi.stubGlobal("matchMedia", undefined);

    function Probe() {
      return <>{String(useMediaQuery(LG_BREAKPOINT_QUERY))}</>;
    }

    expect(renderToString(<Probe />)).toBe("false");
  });
});

describe("LG_BREAKPOINT_QUERY", () => {
  it("is written in rem, matching what Tailwind v4 compiles lg: to", () => {
    // `1024px` agrees with the stylesheet only at a 16px root font size.
    expect(LG_BREAKPOINT_QUERY).toBe("(min-width: 64rem)");
  });
});
