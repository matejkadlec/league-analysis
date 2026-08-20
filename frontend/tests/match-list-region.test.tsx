// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LG_BREAKPOINT_QUERY, useMediaQuery } from "@/lib/core/use-media-query";

// The match list scrolls sideways only from `lg` up (`lg:overflow-x-auto`),
// so only from `lg` up does it need to be a named, keyboard-reachable region.
// Below that a row reflows to fit and the container cannot move, which made
// `tabIndex={0}` a focus stop on a phone that led nowhere.

function stubMatchMedia(matches: boolean) {
  const listeners = new Set<() => void>();
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: (_: string, listener: () => void) =>
      void listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) =>
      void listeners.delete(listener),
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function ScrollRegion() {
  const isDesktopLayout = useMediaQuery(LG_BREAKPOINT_QUERY);
  return (
    <div
      data-testid="match-list"
      {...(isDesktopLayout
        ? { role: "region", "aria-label": "Match list", tabIndex: 0 }
        : {})}
    />
  );
}

describe("the match list scroll region", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("is a keyboard-reachable named region at the width it scrolls at", () => {
    stubMatchMedia(true);
    render(<ScrollRegion />);

    const region = screen.getByRole("region", { name: "Match list" });
    expect(region.getAttribute("tabindex")).toBe("0");
  });

  it("is no region and no focus stop at the widths it cannot scroll", () => {
    stubMatchMedia(false);
    render(<ScrollRegion />);

    expect(screen.queryByRole("region")).toBeNull();
    expect(
      screen.getByTestId("match-list").getAttribute("tabindex"),
    ).toBeNull();
  });
});
