import { afterAll, afterEach, beforeAll } from "vitest";
import { cleanup } from "@testing-library/react";
import { configure } from "@testing-library/dom";

import { server } from "./tests/support/msw-server";

// Unmount between tests once, here, rather than in every file that renders.
// Vitest runs without `globals`, so Testing Library's auto-cleanup -- which
// engages only when it finds a global `afterEach` -- never fires.
afterEach(cleanup);

// jsdom has no `window.matchMedia`, so a component reading a breakpoint throws
// on render. The stub answers "does not match", so components render their
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
// shared aarch64 Pi that builds containers in the same job. The timeout only
// bounds how long a *failing* query waits, so it costs nothing.
configure({ asyncUtilTimeout: 5000 });

// The seam the data-fetching suites are written against: the real axios
// client, its interceptors and its zod validation all run, and only the
// socket is answered from a handler. `error` is what makes a wrong URL fail.
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
