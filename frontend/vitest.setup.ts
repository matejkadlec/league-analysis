import { afterAll, afterEach, beforeAll } from "vitest";
import { cleanup } from "@testing-library/react";
import { configure } from "@testing-library/dom";

import { server } from "./tests/support/msw-server";

// Vitest runs without `globals`, so Testing Library's auto-cleanup -- which
// engages only on a global `afterEach` -- never fires.
afterEach(cleanup);

// jsdom has no `window.matchMedia`, so reading a breakpoint throws on render.
// The stub always answers "does not match"; override it for the other branch.
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

// Five seconds, not the 1000ms default: the CI runner is a loaded aarch64 Pi.
// Only a *failing* query waits the full timeout, so the slack costs nothing.
configure({ asyncUtilTimeout: 5000 });

// Only the socket is stubbed: the real axios client, its interceptors and its
// zod validation all run, and `error` is what makes a wrong URL fail.
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
