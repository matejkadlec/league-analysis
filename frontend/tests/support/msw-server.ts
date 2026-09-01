import { setupServer } from "msw/node";

/**
 * Empty by construction: `vitest.setup.ts` resets it after every test, so a
 * handler belongs to the test that declared it and cannot leak onward.
 */
export const server = setupServer();
