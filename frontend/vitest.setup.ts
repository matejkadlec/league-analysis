import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { configure } from "@testing-library/dom";

// Unmount between tests once, here, rather than in every file that renders.
// Vitest runs without `globals`, so Testing Library's auto-cleanup -- which
// engages only when it finds a global `afterEach` -- never fires. A leaked
// tree reads as a duplicate element rather than as missing teardown.
afterEach(cleanup);

// jsdom has no CSS engine and so no `window.matchMedia`, and a component
// reading a breakpoint throws on render. The stub answers "does not match",
// the same server snapshot `useMediaQuery` takes, so components render their
// mobile-first branch; override `window.matchMedia` to exercise the other.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// Five seconds, not Testing Library's 1000ms default: the CI runner is a
// shared aarch64 Pi that builds containers in the same job, where tests
// measured 1.8s against under 100ms locally. The timeout only bounds how long
// a *failing* query waits, so it costs nothing.
configure({ asyncUtilTimeout: 5000 });
