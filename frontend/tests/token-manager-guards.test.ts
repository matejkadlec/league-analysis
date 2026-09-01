// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  namesTheEndOfTheSession,
  refreshAccessToken,
} from "@/lib/session/token-manager";

/**
 * Node environment on purpose: the second test needs `window` genuinely
 * absent.
 */

describe("a refusal has to be readable to count", () => {
  it("does not end the session on a JSON content-type it cannot parse", async () => {
    // An edge answering 401 labelled JSON with something else: `return true`
    // in the catch would strand the visitor signed out on an unparseable body.
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
    // A server-side render sends no cookies, so returning `refused` would have
    // every SSR pass conclude the session is over.
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    expect(await refreshAccessToken()).toEqual({ outcome: "unreachable" });
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });
});
