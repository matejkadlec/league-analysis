// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  namesTheEndOfTheSession,
  refreshAccessToken,
} from "@/features/auth/utils/token-manager";

/**
 * The two ways a session can end that nothing was watching -- both found by
 * mutating `token-manager.ts`, with 342 tests green through each. Node
 * environment on purpose: the second test needs `window` genuinely absent.
 */

describe("a refusal has to be readable to count", () => {
  it("does not end the session on a JSON content-type it cannot parse", async () => {
    // The shape that gets here: an edge or proxy answers 401 labelled JSON and
    // serves something that is not. `return true` in the catch passed every
    // test in the suite -- and would sign the visitor out on an unparseable
    // body, which is the stranded session this function exists to prevent.
    const unreadable = new Response("<html>challenge</html>", {
      status: 401,
      headers: { "content-type": "application/json" },
    });

    expect(await namesTheEndOfTheSession(unreadable)).toBe(false);
  });

  it("still reads a well-formed refusal", async () => {
    // The negative control: without this, returning a blanket `false` from the
    // function would also pass the test above.
    const refusal = new Response(
      JSON.stringify({ detail: { code: "INVALID_REFRESH_TOKEN" } }),
      { status: 401, headers: { "content-type": "application/json" } },
    );

    expect(await namesTheEndOfTheSession(refusal)).toBe(true);
  });
});

describe("refreshing where there is no browser", () => {
  it("reports nothing learned rather than a refusal", async () => {
    // Server-side render: there are no cookies to send, so the server can only
    // fail to answer about a session it was never asked about. Returning
    // `refused` here -- which the suite also accepted -- would have every SSR
    // pass conclude the visitor's session is over.
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    expect(await refreshAccessToken()).toEqual({ outcome: "unreachable" });
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });
});
