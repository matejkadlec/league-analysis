import { setupServer } from "msw/node";

/**
 * The network seam the converted suites write handlers against. Empty by
 * construction: `vitest.setup.ts` resets it after every test, so a handler
 * belongs to the test that declared it and cannot leak into the next one.
 */
export const server = setupServer();
